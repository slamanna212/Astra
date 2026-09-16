"""Session list/detail queries over ``state.db`` (read-only SQL, introspected columns).

Ordering is ``(pinned DESC, COALESCE(last_activity_at, started_at) DESC, id DESC)`` when
``pinned_first`` is set, else ``(activity DESC, id DESC)``. Pagination is keyset-based; the
cursor carries the last row's sort key plus a fingerprint of the filters it was issued for.

Index note: Hermes has no index on ``last_activity_at`` (or on the COALESCE expression), and we
must not create one (the DB is Hermes-owned and opened read-only). The list query is therefore a
scan of ``sessions`` plus a temp B-tree sort — cheap at this table's scale (hundreds to low
thousands of rows; see scripts/bench_sessions.py for measured latency).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from astra.db import Schema
from astra.models import SessionDetail, SessionSummary

MAX_LIMIT = 200
DEFAULT_LIMIT = 50

BOOL_FIELDS = ("pinned", "archived", "hidden")

SessionStatus = Literal["active", "archived", "hidden", "all"]
_INT_DEFAULT_ZERO = {
    "message_count",
    "tool_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "api_call_count",
    "rewind_count",
}

SUMMARY_FIELDS: tuple[str, ...] = tuple(SessionSummary.model_fields)
# Detail columns are an explicit allowlist. Deliberately excluded: system_prompt, system_prompt_hash,
# model_config (embeds provider runtime config), origin_json, session_key, user_id, chat_id,
# thread_id, billing_base_url, handoff_error, compression_* internals.
DETAIL_FIELDS: tuple[str, ...] = tuple(SessionDetail.model_fields)


class InvalidCursor(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ListParams:
    limit: int = DEFAULT_LIMIT
    cursor: str | None = None
    sources: tuple[str, ...] = ()
    status: SessionStatus = "active"
    pinned_first: bool = True

    def fingerprint(self) -> str:
        key = json.dumps([sorted(set(self.sources)), self.status, self.pinned_first])
        return hashlib.sha256(key.encode()).hexdigest()[:12]


@dataclass(frozen=True, slots=True)
class CursorKey:
    pinned: int
    activity: float
    id: str


def encode_cursor(key: CursorKey, params: ListParams) -> str:
    raw = json.dumps(
        {"v": 1, "f": params.fingerprint(), "p": key.pinned, "a": key.activity, "i": key.id},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def decode_cursor(cursor: str, params: ListParams) -> CursorKey:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        if data.get("v") != 1:
            raise InvalidCursor("unsupported cursor version")
        key = CursorKey(pinned=int(data["p"]), activity=float(data["a"]), id=str(data["i"]))
        fingerprint = data["f"]
    except InvalidCursor:
        raise
    except (ValueError, KeyError, TypeError, binascii.Error, AttributeError):
        raise InvalidCursor("malformed cursor") from None
    if fingerprint != params.fingerprint():
        raise InvalidCursor("cursor does not match the current filters")
    return key


def _flag_expr(schema: Schema, column: str) -> str:
    return f"(COALESCE({column}, 0) != 0)" if schema.has("sessions", column) else "0"


def _activity_expr(schema: Schema) -> str:
    if schema.has("sessions", "last_activity_at"):
        return "COALESCE(last_activity_at, started_at, 0)"
    return "COALESCE(started_at, 0)"


def _select_list(schema: Schema, fields: Sequence[str]) -> str:
    cols = schema.table("sessions")
    return ", ".join(f for f in fields if f in cols)


def _row_to_dict(row: sqlite3.Row, fields: Sequence[str]) -> dict[str, Any]:
    keys = set(row.keys())
    out: dict[str, Any] = {}
    for name in fields:
        value = row[name] if name in keys else None
        if name in BOOL_FIELDS:
            value = bool(value)
        elif name in _INT_DEFAULT_ZERO and value is None:
            value = 0
        out[name] = value
    return out


def build_list_query(schema: Schema, params: ListParams) -> tuple[str, list[Any]]:
    """Return (sql, args). Exposed for EXPLAIN QUERY PLAN in tests/bench."""
    if not schema.has("sessions", "id"):
        raise sqlite3.OperationalError("no such column: sessions.id")
    pinned = _flag_expr(schema, "pinned") if params.pinned_first else "0"
    activity = _activity_expr(schema)
    where: list[str] = []
    args: list[Any] = []

    if params.sources and schema.has("sessions", "source"):
        where.append(f"source IN ({', '.join('?' for _ in params.sources)})")
        args.extend(params.sources)
    if params.status == "active":
        if schema.has("sessions", "archived"):
            where.append("COALESCE(archived, 0) = 0")
        if schema.has("sessions", "hidden"):
            where.append("COALESCE(hidden, 0) = 0")
    elif params.status == "archived" and schema.has("sessions", "archived"):
        where.append("COALESCE(archived, 0) != 0")
    elif params.status == "hidden" and schema.has("sessions", "hidden"):
        where.append("COALESCE(hidden, 0) != 0")

    if params.cursor:
        key = decode_cursor(params.cursor, params)
        # All sort terms are DESC, so "rows after the cursor" is a row-value "<".
        where.append(f"({pinned}, {activity}, id) < (?, ?, ?)")
        args.extend([key.pinned, key.activity, key.id])

    sql = (
        f"SELECT {_select_list(schema, SUMMARY_FIELDS)}, "
        f"{pinned} AS _sort_pinned, {activity} AS _sort_activity "
        "FROM sessions"
        + (f" WHERE {' AND '.join(where)}" if where else "")
        + " ORDER BY _sort_pinned DESC, _sort_activity DESC, id DESC LIMIT ?"
    )
    args.append(params.limit + 1)
    return sql, args


def list_sessions(
    conn: sqlite3.Connection, schema: Schema, params: ListParams
) -> tuple[list[SessionSummary], str | None]:
    sql, args = build_list_query(schema, params)
    rows = conn.execute(sql, args).fetchall()
    has_more = len(rows) > params.limit
    rows = rows[: params.limit]
    items = [SessionSummary(**_row_to_dict(r, SUMMARY_FIELDS)) for r in rows]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            CursorKey(
                pinned=int(last["_sort_pinned"]),
                activity=float(last["_sort_activity"]),
                id=str(last["id"]),
            ),
            params,
        )
    return items, next_cursor


def get_session(conn: sqlite3.Connection, schema: Schema, session_id: str) -> SessionDetail | None:
    row = conn.execute(
        f"SELECT {_select_list(schema, DETAIL_FIELDS)} FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if row is None:
        return None
    return SessionDetail(**_row_to_dict(row, DETAIL_FIELDS))


def count_sessions(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])

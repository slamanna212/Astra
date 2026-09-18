"""Message window paging over ``state.db`` (read-only SQL, introspected columns).

Visibility decision (evidence, not guesswork)
----------------------------------------------
Hermes' own ``hermes_state.SessionDB.get_messages`` (the reference the agent itself reads
history through) defaults to ``active = 1`` only, but explicitly documents a second mode for
*display* reads::

    Pass ``include_compacted=True`` to additionally load rows preserved by in-place context
    compaction (``active=0, compacted=1``). Those are durable display history, not soft-deleted
    rows — a user-visible transcript read must not drop them, or earlier turns silently become
    unreachable once the UI exhausts its active-only window. Soft-deleted Undo/Rewind rows
    (``active=0, compacted=0``) stay excluded; use ``include_inactive`` for those.

A paged transcript viewer is exactly that "user-visible transcript read", so the default here
mirrors Hermes' own ``include_compacted=True`` behaviour: ``active = 1 OR compacted = 1``.
``include_inactive=true`` mirrors Hermes' ``include_inactive`` — every row, including soft-deleted
Undo/Rewind rows (``active=0, compacted=0``), for audit/debug views. Verified against the real
`exampledata/hermes-home/state.db`: ``active=1`` → 28,823 rows, ``compacted=1`` → 6,492 rows (a
subset of ``active=0``), ``observed`` is always 0 (unused by this Hermes build).

``display_kind`` rows (session notices such as "auto_continue" or "hidden") are ordinary
``active=1`` rows in the real data, so no special-casing is needed to preserve them — they pass
through the same filter and are flagged via the ``display_kind``/``display_metadata`` fields for
the frontend to render as subtle notices instead of chat bubbles (BUILD-SPEC §4.6).

Ordering is by ``id`` (AUTOINCREMENT insertion order), not ``timestamp`` — Hermes' own comment
notes a WSL2 clock-regression rationale for this, and ``idx_messages_session_id (session_id, id)``
makes id-keyset paging an index range scan either direction.

Truncation: any ``content``/``reasoning`` value over 64 KB is cut to a UTF-8-safe prefix and
flagged ``truncated``; the full row is available via ``get_message``. Tool-call ``arguments`` are
truncated independently at a much smaller threshold (they inflate the *window* response, not the
single-message one). ``api_content`` and the ``codex_*`` columns are internal transport blobs
(raw provider payloads / codex reasoning items) and are never read or exposed, full row included.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from astra.db import Schema
from astra.models import ChildSession, Message, MessagePage, ToolCallOut

DEFAULT_LIMIT = 200
MAX_LIMIT = 500

MAX_INLINE_BYTES = 64 * 1024
MAX_TOOL_ARG_CHARS = 4096

# Columns we ever read. Deliberately excludes api_content, codex_reasoning_items,
# codex_message_items (internal transport blobs), reasoning_details (redundant — see module
# docstring in the evidence trail: it never appears without reasoning/reasoning_content),
# observed (always 0, unused), platform_message_id and _compressed_summary (implementation
# bookkeeping, not conversation content).
CANDIDATE_COLUMNS: tuple[str, ...] = (
    "id",
    "role",
    "content",
    "tool_call_id",
    "tool_calls",
    "tool_name",
    "effect_disposition",
    "timestamp",
    "token_count",
    "finish_reason",
    "reasoning",
    "reasoning_content",
    "active",
    "compacted",
    "display_kind",
    "display_metadata",
)


class SessionNotFound(Exception):
    pass


class MessageNotFound(Exception):
    pass


@dataclass(frozen=True, slots=True)
class WindowParams:
    limit: int = DEFAULT_LIMIT
    before_id: int | None = None
    after_id: int | None = None
    around_id: int | None = None
    include_inactive: bool = False


def _select_columns(schema: Schema) -> str:
    cols = schema.table("messages")
    present = [c for c in CANDIDATE_COLUMNS if c in cols]
    return ", ".join(present)


def _visibility_expr(schema: Schema, include_inactive: bool) -> str:
    if include_inactive or not schema.has("messages", "active"):
        return "1"
    if schema.has("messages", "compacted"):
        return "(COALESCE(active, 1) = 1 OR COALESCE(compacted, 0) = 1)"
    return "COALESCE(active, 1) = 1"


def _truncate_text(value: str | None) -> tuple[str | None, bool]:
    if value is None:
        return None, False
    data = value.encode("utf-8", "surrogatepass")
    if len(data) <= MAX_INLINE_BYTES:
        return value, False
    return data[:MAX_INLINE_BYTES].decode("utf-8", "ignore"), True


def _parse_content(raw: str | None, *, truncate: bool) -> tuple[Any, bool]:
    text, was_truncated = _truncate_text(raw) if truncate else (raw, False)
    if text is None:
        return None, was_truncated
    stripped = text.lstrip()
    # Defensive: no structured multimodal content was observed in real data (content is always
    # plain text there), but parse a JSON array of typed parts if one ever shows up rather than
    # rendering it as a raw JSON string. Never attempted on a truncated (possibly invalid-JSON)
    # prefix.
    if not was_truncated and stripped[:1] in "[{":
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError, ValueError):
            return text, was_truncated
        if isinstance(parsed, list) and parsed and all(isinstance(p, dict) and "type" in p for p in parsed):
            return parsed, was_truncated
    return text, was_truncated


def _parse_display_metadata(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_tool_calls(raw: str | None) -> list[ToolCallOut] | None:
    if not raw:
        return None
    try:
        calls = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if not isinstance(calls, list):
        return None
    out: list[ToolCallOut] = []
    for call in calls:
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        call_id = call.get("id") or call.get("call_id") or ""
        name = fn.get("name") or call.get("name")
        args_raw = fn.get("arguments", call.get("arguments"))
        args: Any = args_raw
        truncated = False
        if isinstance(args_raw, str):
            if len(args_raw) > MAX_TOOL_ARG_CHARS:
                args = args_raw[:MAX_TOOL_ARG_CHARS]
                truncated = True
            else:
                try:
                    args = json.loads(args_raw)
                except (json.JSONDecodeError, TypeError, ValueError):
                    args = args_raw
        out.append(
            ToolCallOut(id=str(call_id), name=name, arguments=args, arguments_truncated=truncated)
        )
    return out or None


def _row_to_message(row: sqlite3.Row, *, truncate: bool) -> Message:
    keys = set(row.keys())

    def get(name: str) -> Any:
        return row[name] if name in keys else None

    reasoning_raw = get("reasoning_content") or get("reasoning")
    content, content_truncated = _parse_content(get("content"), truncate=truncate)
    reasoning, reasoning_truncated = (
        _truncate_text(reasoning_raw) if truncate else (reasoning_raw, False)
    )
    return Message(
        id=int(row["id"]),
        role=row["role"],
        content=content,
        truncated=content_truncated or reasoning_truncated,
        tool_calls=_parse_tool_calls(get("tool_calls")),
        tool_call_id=get("tool_call_id"),
        tool_name=get("tool_name"),
        timestamp=float(row["timestamp"]),
        token_count=get("token_count"),
        finish_reason=get("finish_reason"),
        reasoning=reasoning,
        display_kind=get("display_kind") or None,
        display_metadata=_parse_display_metadata(get("display_metadata")),
        effect_disposition=get("effect_disposition"),
        active=bool(get("active")) if "active" in keys and get("active") is not None else True,
        compacted=bool(get("compacted")) if "compacted" in keys else False,
    )


def session_exists(conn: sqlite3.Connection, session_id: str) -> bool:
    return conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is not None


def get_window(
    conn: sqlite3.Connection, schema: Schema, session_id: str, params: WindowParams
) -> MessagePage:
    if not session_exists(conn, session_id):
        raise SessionNotFound(session_id)

    cols = _select_columns(schema)
    # A deep link to a specific message (search hit, "around_id") must not silently vanish just
    # because it happens to be a rewound/compacted row — force full visibility for that lookup.
    effective_include_inactive = params.include_inactive or params.around_id is not None
    visible = _visibility_expr(schema, effective_include_inactive)

    if params.around_id is not None:
        target = conn.execute(
            f"SELECT {cols} FROM messages WHERE session_id = ? AND id = ? AND {visible}",
            (session_id, params.around_id),
        ).fetchone()
        if target is None:
            raise MessageNotFound(params.around_id)
        half = params.limit // 2
        before_rows = conn.execute(
            f"SELECT {cols} FROM messages WHERE session_id = ? AND id < ? AND {visible} "
            "ORDER BY id DESC LIMIT ?",
            (session_id, params.around_id, half),
        ).fetchall()
        remaining = max(params.limit - len(before_rows) - 1, 0)
        after_rows = conn.execute(
            f"SELECT {cols} FROM messages WHERE session_id = ? AND id > ? AND {visible} "
            "ORDER BY id ASC LIMIT ?",
            (session_id, params.around_id, remaining),
        ).fetchall()
        rows = list(reversed(before_rows)) + [target] + list(after_rows)
    elif params.after_id is not None:
        rows = conn.execute(
            f"SELECT {cols} FROM messages WHERE session_id = ? AND id > ? AND {visible} "
            "ORDER BY id ASC LIMIT ?",
            (session_id, params.after_id, params.limit),
        ).fetchall()
    elif params.before_id is not None:
        rows = list(
            reversed(
                conn.execute(
                    f"SELECT {cols} FROM messages WHERE session_id = ? AND id < ? AND {visible} "
                    "ORDER BY id DESC LIMIT ?",
                    (session_id, params.before_id, params.limit),
                ).fetchall()
            )
        )
    else:
        rows = list(
            reversed(
                conn.execute(
                    f"SELECT {cols} FROM messages WHERE session_id = ? AND {visible} "
                    "ORDER BY id DESC LIMIT ?",
                    (session_id, params.limit),
                ).fetchall()
            )
        )

    items = [_row_to_message(r, truncate=True) for r in rows]
    oldest_id = items[0].id if items else None
    newest_id = items[-1].id if items else None
    has_older = False
    has_newer = False
    if oldest_id is not None:
        has_older = (
            conn.execute(
                f"SELECT 1 FROM messages WHERE session_id = ? AND id < ? AND {visible} LIMIT 1",
                (session_id, oldest_id),
            ).fetchone()
            is not None
        )
        has_newer = (
            conn.execute(
                f"SELECT 1 FROM messages WHERE session_id = ? AND id > ? AND {visible} LIMIT 1",
                (session_id, newest_id),
            ).fetchone()
            is not None
        )
    return MessagePage(
        items=items, has_older=has_older, has_newer=has_newer, oldest_id=oldest_id, newest_id=newest_id
    )


def get_message(
    conn: sqlite3.Connection, schema: Schema, session_id: str, message_id: int
) -> Message:
    if not session_exists(conn, session_id):
        raise SessionNotFound(session_id)
    cols = _select_columns(schema)
    row = conn.execute(
        f"SELECT {cols} FROM messages WHERE session_id = ? AND id = ?", (session_id, message_id)
    ).fetchone()
    if row is None:
        raise MessageNotFound(message_id)
    return _row_to_message(row, truncate=False)


def list_child_sessions(conn: sqlite3.Connection, schema: Schema, session_id: str) -> list[ChildSession]:
    """Sub-agent sessions delegated *from* this one (``sessions.parent_session_id`` +
    ``source = 'subagent'``), for surfacing subagent links next to a ``delegate_task`` tool call.
    Best-effort: a delegation can dispatch several subagents at once (verified in the real DB —
    one ``delegate_task`` call, ``count: 3`` in its result, three children with ``started_at``
    within ~70 ms of each other), so the frontend matches by proximity to the tool call's
    timestamp rather than a 1:1 id reference — Hermes does not record one in ``messages`` or in
    the tool result.

    Scoped to ``source = 'subagent'``: ``parent_session_id`` is also set on forked and
    context-compression child sessions, which already appear as their own top-level rows in the
    session list, so including them here would duplicate them into the sub-agent nesting.
    """
    if not schema.has("sessions", "parent_session_id"):
        return []
    all_fields = ("id", "title", "display_name", "started_at", "source", "message_count")
    fields = [c for c in all_fields if schema.has("sessions", c)]
    if "id" not in fields:
        return []
    source_filter = " AND source = 'subagent'" if schema.has("sessions", "source") else ""
    rows = conn.execute(
        f"SELECT {', '.join(fields)} FROM sessions WHERE parent_session_id = ?{source_filter} "
        "ORDER BY started_at",
        (session_id,),
    ).fetchall()
    present = set(fields)
    return [ChildSession(**{f: (row[f] if f in present else None) for f in all_fields}) for row in rows]

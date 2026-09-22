"""FTS5 full-text search over ``messages`` (+ a session-title fallback).

FTS vs. trigram (decision, with evidence)
------------------------------------------
``state.db`` ships two FTS5 virtual tables (verified via ``sqlite_master`` on
``exampledata/hermes-home/state.db``):

* ``messages_fts`` — ``content='messages'``, standard (unicode61) tokenizer, indexes every row
  (``content``, ``tool_name``, ``tool_calls``) regardless of role. BUILD-SPEC §0 measured
  ``MATCH 'hermes'`` at 45 ms across 36,448 messages.
* ``messages_fts_trigram`` — ``content='messages_fts_trigram_src'``, a **view** defined as
  ``SELECT id, role, content, tool_name, tool_calls FROM messages WHERE role <> 'tool'`` —
  i.e. it deliberately excludes every ``tool``-role row (16,214 of 36,537 rows on the real DB
  are excluded). Trigram tokenizers exist for substring/CJK matching where whole-token search
  fails, at higher index cost and coverage cost here.

Decision: use ``messages_fts`` as the only search path. It is already well under the 1 s
requirement (see ``scripts/bench_search.py``) for common-word queries, and it is the only one of
the two that covers tool results — a large fraction of real conversations. ``messages_fts_trigram``
is not wired up; it would only be worth adding for substring/CJK search, which is not a stated
Phase 1 requirement, and doing so would silently drop tool-role hits unless run as a second,
separately-merged query.

Sanitization: raw user input can contain FTS5 query syntax (``NEAR``, parentheses, ``*``, bare
``"``) that would otherwise raise a syntax error or change query semantics. Every query is reduced
to its word tokens (``\\w+``) and each token is individually double-quoted, which turns the whole
thing into a safe implicit-AND phrase-token match — quoting a token that happens to spell an
operator (``"NEAR"``) makes FTS5 treat it as a literal string, not the operator.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from astra.db import Schema
from astra.models import SearchHit, SearchPage

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MAX_TERMS = 12

# Private-use-area sentinels: virtually never appear in real text, so the frontend can safely
# split on them to insert <mark> without ever touching dangerouslySetInnerHTML.
SNIPPET_START = ""
SNIPPET_END = ""

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


class InvalidSearchCursor(ValueError):
    pass


def sanitize_query(raw: str) -> str | None:
    """Turn arbitrary user input into a safe FTS5 MATCH string, or ``None`` if it has no terms."""
    terms = _TOKEN_RE.findall(raw)[:MAX_TERMS]
    if not terms:
        return None
    return " ".join(f'"{t}"' for t in terms)


@dataclass(frozen=True, slots=True)
class SearchParams:
    q: str
    limit: int = DEFAULT_LIMIT
    cursor: str | None = None
    sources: tuple[str, ...] = ()

    def fingerprint(self) -> str:
        key = json.dumps([self.q, sorted(set(self.sources))])
        return hashlib.sha256(key.encode()).hexdigest()[:12]


def _encode_cursor(offset: int, params: SearchParams) -> str:
    raw = json.dumps({"v": 1, "f": params.fingerprint(), "o": offset}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def _decode_cursor(cursor: str, params: SearchParams) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        if data.get("v") != 1:
            raise InvalidSearchCursor("unsupported cursor version")
        offset = int(data["o"])
        fingerprint = data["f"]
    except InvalidSearchCursor:
        raise
    except (ValueError, KeyError, TypeError, binascii.Error, AttributeError):
        raise InvalidSearchCursor("malformed cursor") from None
    if fingerprint != params.fingerprint():
        raise InvalidSearchCursor("cursor does not match the current query") from None
    if offset < 0:
        raise InvalidSearchCursor("malformed cursor")
    return offset


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _mark_first_match(text: str, needle: str) -> str:
    idx = text.lower().find(needle.lower())
    if idx < 0 or not needle:
        return text
    return text[:idx] + SNIPPET_START + text[idx : idx + len(needle)] + SNIPPET_END + text[idx + len(needle) :]


def _search_titles(conn: sqlite3.Connection, params: SearchParams, *, limit: int) -> list[SearchHit]:
    q = params.q.strip()
    if not q or limit <= 0:
        return []
    pattern = f"%{_escape_like(q)}%"
    where = ["(title LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')"]
    args: list[Any] = [pattern, pattern]
    if params.sources:
        where.append(f"source IN ({', '.join('?' for _ in params.sources)})")
        args.extend(params.sources)
    sql = (
        "SELECT id, title, display_name, source, COALESCE(last_activity_at, started_at, 0) AS ts "
        "FROM sessions WHERE " + " AND ".join(where) + " ORDER BY ts DESC LIMIT ?"
    )
    args.append(limit)
    rows = conn.execute(sql, args).fetchall()
    hits: list[SearchHit] = []
    for row in rows:
        title, display_name = row["title"], row["display_name"]
        # The WHERE clause matches title OR display_name — mark whichever one actually matched
        # (a session can have a title that says nothing like the query while its display_name
        # does, e.g. a Discord channel name).
        label = title if title and q.lower() in title.lower() else (display_name or title or "")
        hits.append(
            SearchHit(
                session_id=row["id"],
                session_title=title or display_name,
                source=row["source"],
                message_id=None,
                role="session_title",
                timestamp=row["ts"],
                snippet=_mark_first_match(label, q),
            )
        )
    return hits


_MAX_TITLE_HITS_PER_PAGE = 5


def search_messages(conn: sqlite3.Connection, schema: Schema, params: SearchParams) -> SearchPage:
    del schema  # messages_fts/messages/sessions are always present alongside FTS5 support
    offset = _decode_cursor(params.cursor, params) if params.cursor else 0
    fts_query = sanitize_query(params.q)

    # Session-title matches are cheap (LIKE over a few hundred/thousand rows) and reserved a small
    # slice of the first page so a title hit is never crowded out by a theme that also has many
    # message-body hits (e.g. a session titled "network scan" whose own transcript says
    # "network" and "scan" a few hundred times). Later pages are pure message-hit pagination.
    title_hits: list[SearchHit] = []
    if offset == 0:
        # A small, size-proportional reservation: enough that a themed title (e.g. "network
        # scan") isn't crowded out entirely by hundreds of message-body hits on the same words,
        # but not so much that a small page (limit=3) ends up all titles and no conversation
        # content.
        title_limit = min(_MAX_TITLE_HITS_PER_PAGE, params.limit // 3)
        title_hits = _search_titles(conn, params, limit=title_limit)

    message_limit = max(params.limit - len(title_hits), 0)
    message_items: list[SearchHit] = []
    has_more = False
    if fts_query is not None and message_limit > 0:
        where = ["messages_fts MATCH ?"]
        args: list[Any] = [fts_query]
        if params.sources:
            where.append(f"s.source IN ({', '.join('?' for _ in params.sources)})")
            args.extend(params.sources)
        sql = (
            "SELECT m.id AS message_id, m.role, m.timestamp, m.tool_name, "
            "s.id AS session_id, s.title AS session_title, s.display_name, s.source, "
            f"snippet(messages_fts, 0, '{SNIPPET_START}', '{SNIPPET_END}', ' ... ', 12) AS snip "
            "FROM messages_fts "
            "JOIN messages m ON m.id = messages_fts.rowid "
            "JOIN sessions s ON s.id = m.session_id "
            f"WHERE {' AND '.join(where)} "
            # FTS5's rank cursor can stop at LIMIT instead of sorting every matching row.
            # Pin the ranking function explicitly in case Hermes changes the table default.
            "AND rank MATCH 'bm25()' ORDER BY messages_fts.rank LIMIT ? OFFSET ?"
        )
        args.extend([message_limit + 1, offset])
        try:
            rows = conn.execute(sql, args).fetchall()
        except sqlite3.OperationalError:
            # Sanitization should make this unreachable, but a search endpoint must never 500 on
            # user input — fail closed to "no results" instead.
            rows = []
        has_more = len(rows) > message_limit
        rows = rows[:message_limit]
        for row in rows:
            snippet = row["snip"] or (f"[tool: {row['tool_name']}]" if row["tool_name"] else "")
            message_items.append(
                SearchHit(
                    session_id=row["session_id"],
                    session_title=row["session_title"] or row["display_name"],
                    source=row["source"],
                    message_id=row["message_id"],
                    role=row["role"],
                    timestamp=row["timestamp"],
                    snippet=snippet,
                )
            )

    items = title_hits + message_items
    next_cursor = _encode_cursor(offset + len(message_items), params) if has_more else None
    return SearchPage(items=items, next_cursor=next_cursor)

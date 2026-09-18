"""Usage/token/cost aggregation over ``state.db`` (BUILD-SPEC §4.5, §5.7).

Everything here reads only ``sessions`` and ``session_model_usage`` — never messages content,
never a JSON index. Two tables answer every question this module asks (verified against the real
333 MB ``exampledata/hermes-home/state.db`` and Hermes' own ``agent/insights.py``, which computes
the "hermes insights" CLI/gateway report from the same tables):

Semantics decisions (evidence in the Phase 1 handoff report, summarized here for maintainers)
------------------------------------------------------------------------------------------------
1. **``session_model_usage`` double-counting.** Every row is keyed
   ``(session_id, model, billing_provider, billing_base_url, billing_mode, task)``. Rows with
   ``task = ''`` are the main agent loop; ``hermes_state._record_model_usage`` writes them in the
   same transaction as the ``sessions`` UPDATE, from the *same* per-call delta. Measured on the
   real DB: summing ``task=''`` rows per session reproduces ``sessions.input_tokens`` /
   ``output_tokens`` / ``cache_read_tokens`` / ``reasoning_tokens`` / ``api_call_count`` /
   ``estimated_cost_usd`` almost exactly (aggregate diff over 432 sessions: 63,363 of 116,772,938
   input tokens, i.e. ~0.05% — the residual Hermes' own code attributes to "absolute cumulative"
   updates from the gateway path that never got split per-call; see
   ``agent/insights.py:703-741``). Rows with a non-empty ``task`` (``approval``,
   ``title_generation``, ``background_review``, ``compression``, ``vision``, ...) are auxiliary
   LLM calls that ``hermes_state.record_auxiliary_usage`` writes and that are **never** added to
   ``sessions.*`` (confirmed by reading ``agent/aux_accounting.py`` — the only place aux usage is
   recorded is this table). So: summing ``sessions.*`` gives exact main-loop totals with no risk
   of double-counting aux spend on top of it; aux totals must be added *on top*, not instead of.
   This mirrors Hermes' own ``InsightsEngine._compute_overview`` (see the comment at
   ``agent/insights.py:522-530``): "the per-model breakdown includes auxiliary usage rows ... while
   the sessions counters carry main-loop usage only. Summing the breakdown keeps overview totals
   consistent ... and stops undercounting aux spend."
2. **Subagent double-counting.** Sessions with ``source='subagent'`` are independent rows with
   their own ``id`` and ``parent_session_id`` pointing at the invoker. Verified in
   ``hermes_state.update_token_counts``: every call is keyed by the *live* ``session_id`` passed to
   it (the subagent's own id when a delegated agent is running), and there is no code path that
   also adds a subagent's usage to the parent's row. A real-DB spot check confirms it: a parent
   session with three delegated subagents keeps its own token/message counts unaffected by the
   children (each child has its own non-trivial message_count/tokens). Consequence: summing over
   *all* rows in ``sessions`` (subagents included) is correct and does not double-count anything.
   Subagents get their own bucket in the per-source breakdown rather than being merged into their
   parent's source.
3. **Day bucketing.** Sessions can span midnight (rare: 7 of 431 real sessions run past 24h, none
   past 7 days), and ``session_model_usage`` only carries ``first_seen``/``last_seen`` per
   (session, model, task) — not a per-call timestamp we could bucket by. Message-level timestamps
   would let us bucket exactly, but that means scanning conversation content to render a chart,
   which is exactly what BUILD-SPEC §6.2 forbids. We bucket a session's *entire* window by the
   calendar day of ``sessions.started_at`` in the caller's timezone — one bucket per session, no
   splitting. Given the row counts involved (hundreds, see bench_insights.py), all matching
   sessions are fetched once and bucketed in Python via ``zoneinfo`` (correct across DST; SQLite
   has no IANA timezone support), rather than pushing day-truncation into SQL.
4. **Cache hit rate.** ``cache_read_tokens / (input_tokens + cache_read_tokens)``. Rationale:
   ``input_tokens`` and ``cache_read_tokens`` are the two ways "context" tokens are billed
   (freshly processed vs. served from a warm cache); ``cache_write_tokens`` is excluded from the
   denominator because writing a cache entry is not itself a hit or a miss on existing context —
   it is closer to a write amplification cost. Computed over main+auxiliary combined.
"""

from __future__ import annotations

import sqlite3
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from astra.db import Schema
from astra.models import (
    InsightsAuxiliaryTask,
    InsightsDailyPoint,
    InsightsModelUsage,
    InsightsProviderUsage,
    InsightsResponse,
    InsightsSourceUsage,
    InsightsTopSession,
    InsightsTotals,
)

ALLOWED_DAYS: tuple[str, ...] = ("1", "7", "30", "90", "365", "all")
TOP_SESSIONS_LIMIT = 10

_SESSION_ROW_COLS = (
    "id",
    "source",
    "model",
    "billing_provider",
    "started_at",
    "message_count",
    "tool_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "api_call_count",
    "estimated_cost_usd",
    "actual_cost_usd",
    "title",
    "display_name",
)

_TOTALS_SUM_COLS = (
    "message_count",
    "tool_call_count",
    "api_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "estimated_cost_usd",
    "actual_cost_usd",
)


class InvalidTimezone(ValueError):
    pass


def resolve_zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except Exception as exc:  # zoneinfo raises different exception types across platforms
        raise InvalidTimezone(f"unknown timezone: {tz!r}") from exc


def _cutoff(days: str, now: float) -> float | None:
    if days == "all":
        return None
    return now - int(days) * 86400


def _select(schema: Schema, table: str, cols: tuple[str, ...]) -> str:
    available = schema.table(table)
    return ", ".join(c for c in cols if c in available)


def _num(row: sqlite3.Row | dict[str, Any], key: str, default: float = 0.0) -> float:
    # sqlite3.Row's `in` checks values, not keys, so `.keys()` is required here.
    value = row[key] if key in row.keys() else None  # noqa: SIM118
    return value if value is not None else default


@dataclass
class _Bucket:
    sessions: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    estimated_cost_usd: float = 0.0


@dataclass
class _GroupTotals:
    sessions: set[str] = field(default_factory=set)
    messages: int = 0
    tool_calls: int = 0
    api_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    estimated_cost_usd: float = 0.0
    actual_cost_usd: float = 0.0


def _fetch_session_rows(
    conn: sqlite3.Connection, schema: Schema, cutoff: float | None
) -> list[sqlite3.Row]:
    if not schema.has("sessions", "id") or not schema.has("sessions", "started_at"):
        return []
    cols = _select(schema, "sessions", _SESSION_ROW_COLS)
    sql = f"SELECT {cols} FROM sessions"
    args: list[Any] = []
    if cutoff is not None:
        sql += " WHERE started_at >= ?"
        args.append(cutoff)
    return conn.execute(sql, args).fetchall()


def _fetch_totals_row(
    conn: sqlite3.Connection, schema: Schema, cutoff: float | None
) -> sqlite3.Row | None:
    if not schema.has("sessions", "id"):
        return None
    sum_cols = [c for c in _TOTALS_SUM_COLS if schema.has("sessions", c)]
    select = ", ".join(f"COALESCE(SUM({c}), 0) AS {c}" for c in sum_cols)
    sql = f"SELECT COUNT(*) AS sessions, {select} FROM sessions"
    args: list[Any] = []
    if cutoff is not None:
        sql += " WHERE started_at >= ?"
        args.append(cutoff)
    return conn.execute(sql, args).fetchone()


_USAGE_AGG_COLS = (
    "api_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "estimated_cost_usd",
    "actual_cost_usd",
)


def _fetch_usage_rows(
    conn: sqlite3.Connection, schema: Schema, cutoff: float | None, *, task_filter: str
) -> list[sqlite3.Row]:
    """Fetch ``session_model_usage`` rows joined to the date window.

    ``task_filter`` is ``"="`` for main-loop rows (``task = ''``) or ``"!="`` for auxiliary rows.
    Returns ``[]`` when the table (or a required column) doesn't exist on this Hermes version.
    """
    usage_cols = schema.table("session_model_usage")
    required = {"session_id", "model", "billing_provider", "task", *_USAGE_AGG_COLS}
    if not required.issubset(usage_cols) or not schema.has("sessions", "started_at"):
        return []
    select = ", ".join(f"u.{c}" for c in _USAGE_AGG_COLS)
    sql = (
        f"SELECT u.session_id, u.model, u.billing_provider, u.task, {select} "
        "FROM session_model_usage u JOIN sessions s ON s.id = u.session_id "
        f"WHERE u.task {task_filter} ''"
    )
    args: list[Any] = []
    if cutoff is not None:
        sql += " AND s.started_at >= ?"
        args.append(cutoff)
    return conn.execute(sql, args).fetchall()


def _day_key(epoch: float, zone: ZoneInfo) -> str:
    return datetime.fromtimestamp(epoch, tz=zone).strftime("%Y-%m-%d")


def _daily_series(
    rows: list[sqlite3.Row], zone: ZoneInfo, days: str, now: float
) -> list[InsightsDailyPoint]:
    buckets: dict[str, _Bucket] = defaultdict(_Bucket)
    earliest_key: str | None = None
    for row in rows:
        started_at = _num(row, "started_at", 0.0)
        if not started_at:
            continue
        key = _day_key(started_at, zone)
        if earliest_key is None or key < earliest_key:
            earliest_key = key
        b = buckets[key]
        b.sessions += 1
        b.input_tokens += int(_num(row, "input_tokens"))
        b.output_tokens += int(_num(row, "output_tokens"))
        b.cache_read_tokens += int(_num(row, "cache_read_tokens"))
        b.cache_write_tokens += int(_num(row, "cache_write_tokens"))
        b.reasoning_tokens += int(_num(row, "reasoning_tokens"))
        b.estimated_cost_usd += _num(row, "estimated_cost_usd")

    today = datetime.fromtimestamp(now, tz=zone).date()
    if days == "all":
        if earliest_key is None:
            start_date = today
        else:
            start_date = datetime.strptime(earliest_key, "%Y-%m-%d").date()
    else:
        start_date = today - timedelta(days=int(days) - 1)

    out: list[InsightsDailyPoint] = []
    d = start_date
    # Defensive cap: never emit an absurd number of points even if clock skew or a corrupt
    # started_at produced a huge span.
    max_points = 3660
    while d <= today and len(out) < max_points:
        key = d.strftime("%Y-%m-%d")
        b = buckets.get(key, _Bucket())
        out.append(
            InsightsDailyPoint(
                date=key,
                sessions=b.sessions,
                input_tokens=b.input_tokens,
                output_tokens=b.output_tokens,
                cache_read_tokens=b.cache_read_tokens,
                cache_write_tokens=b.cache_write_tokens,
                reasoning_tokens=b.reasoning_tokens,
                estimated_cost_usd=b.estimated_cost_usd,
            )
        )
        d += timedelta(days=1)
    return out


def _model_provider_breakdown(
    conn: sqlite3.Connection, schema: Schema, cutoff: float | None
) -> tuple[list[InsightsModelUsage], list[InsightsProviderUsage]]:
    usage_rows = _fetch_usage_rows(conn, schema, cutoff, task_filter="=")
    models: dict[str, _GroupTotals] = defaultdict(_GroupTotals)
    providers: dict[str, _GroupTotals] = defaultdict(_GroupTotals)

    if usage_rows:
        for row in usage_rows:
            model = row["model"] or "unknown"
            provider = row["billing_provider"] or "unknown"
            for bucket_map, key in ((models, model), (providers, provider)):
                g = bucket_map[key]
                g.sessions.add(row["session_id"])
                g.api_calls += int(_num(row, "api_call_count"))
                g.input_tokens += int(_num(row, "input_tokens"))
                g.output_tokens += int(_num(row, "output_tokens"))
                g.cache_read_tokens += int(_num(row, "cache_read_tokens"))
                g.cache_write_tokens += int(_num(row, "cache_write_tokens"))
                g.reasoning_tokens += int(_num(row, "reasoning_tokens"))
                g.estimated_cost_usd += _num(row, "estimated_cost_usd")
                g.actual_cost_usd += _num(row, "actual_cost_usd")
    else:
        # session_model_usage missing/too old: fall back to the coarser sessions.model /
        # sessions.billing_provider columns (loses per-model-switch attribution, but nothing
        # is lost for the (very common) case of one model per session).
        for row in _fetch_session_rows(conn, schema, cutoff):
            # sqlite3.Row's `in` checks values, not keys, so `.keys()` is required here.
            model = row["model"] if "model" in row.keys() and row["model"] else "unknown"  # noqa: SIM118
            provider = (
                row["billing_provider"]
                if "billing_provider" in row.keys() and row["billing_provider"]  # noqa: SIM118
                else "unknown"
            )
            for bucket_map, key in ((models, model), (providers, provider)):
                g = bucket_map[key]
                g.sessions.add(row["id"])
                g.api_calls += int(_num(row, "api_call_count"))
                g.input_tokens += int(_num(row, "input_tokens"))
                g.output_tokens += int(_num(row, "output_tokens"))
                g.cache_read_tokens += int(_num(row, "cache_read_tokens"))
                g.cache_write_tokens += int(_num(row, "cache_write_tokens"))
                g.reasoning_tokens += int(_num(row, "reasoning_tokens"))
                g.estimated_cost_usd += _num(row, "estimated_cost_usd")
                g.actual_cost_usd += _num(row, "actual_cost_usd")

    model_list = [
        InsightsModelUsage(
            model=name,
            sessions=len(g.sessions),
            api_calls=g.api_calls,
            input_tokens=g.input_tokens,
            output_tokens=g.output_tokens,
            cache_read_tokens=g.cache_read_tokens,
            cache_write_tokens=g.cache_write_tokens,
            reasoning_tokens=g.reasoning_tokens,
            estimated_cost_usd=g.estimated_cost_usd,
            actual_cost_usd=g.actual_cost_usd,
        )
        for name, g in models.items()
    ]
    model_list.sort(key=lambda m: m.estimated_cost_usd, reverse=True)

    provider_list = [
        InsightsProviderUsage(
            provider=name,
            sessions=len(g.sessions),
            api_calls=g.api_calls,
            input_tokens=g.input_tokens,
            output_tokens=g.output_tokens,
            cache_read_tokens=g.cache_read_tokens,
            cache_write_tokens=g.cache_write_tokens,
            reasoning_tokens=g.reasoning_tokens,
            estimated_cost_usd=g.estimated_cost_usd,
            actual_cost_usd=g.actual_cost_usd,
        )
        for name, g in providers.items()
    ]
    provider_list.sort(key=lambda p: p.estimated_cost_usd, reverse=True)
    return model_list, provider_list


def _auxiliary_breakdown(
    conn: sqlite3.Connection, schema: Schema, cutoff: float | None
) -> list[InsightsAuxiliaryTask]:
    rows = _fetch_usage_rows(conn, schema, cutoff, task_filter="!=")
    tasks: dict[str, _GroupTotals] = defaultdict(_GroupTotals)
    for row in rows:
        task = row["task"] or "unknown"
        g = tasks[task]
        g.sessions.add(row["session_id"])
        g.api_calls += int(_num(row, "api_call_count"))
        g.input_tokens += int(_num(row, "input_tokens"))
        g.output_tokens += int(_num(row, "output_tokens"))
        g.reasoning_tokens += int(_num(row, "reasoning_tokens"))
        g.estimated_cost_usd += _num(row, "estimated_cost_usd")
        g.actual_cost_usd += _num(row, "actual_cost_usd")
    out = [
        InsightsAuxiliaryTask(
            task=name,
            sessions=len(g.sessions),
            api_calls=g.api_calls,
            input_tokens=g.input_tokens,
            output_tokens=g.output_tokens,
            reasoning_tokens=g.reasoning_tokens,
            estimated_cost_usd=g.estimated_cost_usd,
            actual_cost_usd=g.actual_cost_usd,
        )
        for name, g in tasks.items()
    ]
    out.sort(key=lambda t: t.estimated_cost_usd, reverse=True)
    return out


def _source_breakdown(rows: list[sqlite3.Row]) -> list[InsightsSourceUsage]:
    sources: dict[str, _GroupTotals] = defaultdict(_GroupTotals)
    for row in rows:
        # sqlite3.Row's `in` checks values, not keys, so `.keys()` is required here.
        source = row["source"] if "source" in row.keys() and row["source"] else "unknown"  # noqa: SIM118
        g = sources[source]
        g.sessions.add(row["id"])
        g.messages += int(_num(row, "message_count"))
        g.tool_calls += int(_num(row, "tool_call_count"))
        g.input_tokens += int(_num(row, "input_tokens"))
        g.output_tokens += int(_num(row, "output_tokens"))
        g.estimated_cost_usd += _num(row, "estimated_cost_usd")
    out = [
        InsightsSourceUsage(
            source=name,
            sessions=len(g.sessions),
            messages=g.messages,
            tool_calls=g.tool_calls,
            input_tokens=g.input_tokens,
            output_tokens=g.output_tokens,
            estimated_cost_usd=g.estimated_cost_usd,
        )
        for name, g in sources.items()
    ]
    out.sort(key=lambda s: s.sessions, reverse=True)
    return out


def _top_sessions(rows: list[sqlite3.Row]) -> list[InsightsTopSession]:
    def cost_key(row: sqlite3.Row) -> float:
        return _num(row, "estimated_cost_usd", 0.0)

    ranked = sorted(rows, key=cost_key, reverse=True)[:TOP_SESSIONS_LIMIT]
    out = []
    for row in ranked:
        keys = row.keys()
        out.append(
            InsightsTopSession(
                id=row["id"],
                title=row["title"] if "title" in keys else None,
                display_name=row["display_name"] if "display_name" in keys else None,
                source=row["source"] if "source" in keys else None,
                model=row["model"] if "model" in keys else None,
                started_at=row["started_at"] if "started_at" in keys else None,
                estimated_cost_usd=row["estimated_cost_usd"] if "estimated_cost_usd" in keys else None,
                input_tokens=int(_num(row, "input_tokens")),
                output_tokens=int(_num(row, "output_tokens")),
            )
        )
    return out


def build_insights(
    conn: sqlite3.Connection, schema: Schema, *, days: str, tz: str, now: float | None = None
) -> InsightsResponse:
    """Build the full insights report. Blocking — call from a worker thread."""
    if days not in ALLOWED_DAYS:
        raise ValueError(f"days must be one of {ALLOWED_DAYS}, got {days!r}")
    zone = resolve_zone(tz)
    now = now if now is not None else time.time()
    cutoff = _cutoff(days, now)

    totals_row = _fetch_totals_row(conn, schema, cutoff)
    session_rows = _fetch_session_rows(conn, schema, cutoff)
    aux_rows_for_totals = _fetch_usage_rows(conn, schema, cutoff, task_filter="!=")

    main_input = int(_num(totals_row, "input_tokens")) if totals_row is not None else 0
    main_output = int(_num(totals_row, "output_tokens")) if totals_row is not None else 0
    main_cache_read = int(_num(totals_row, "cache_read_tokens")) if totals_row is not None else 0
    main_cache_write = int(_num(totals_row, "cache_write_tokens")) if totals_row is not None else 0
    main_reasoning = int(_num(totals_row, "reasoning_tokens")) if totals_row is not None else 0
    main_cost = _num(totals_row, "estimated_cost_usd") if totals_row is not None else 0.0
    main_actual = _num(totals_row, "actual_cost_usd") if totals_row is not None else 0.0

    aux_input = sum(int(_num(r, "input_tokens")) for r in aux_rows_for_totals)
    aux_output = sum(int(_num(r, "output_tokens")) for r in aux_rows_for_totals)
    aux_cache_read = sum(int(_num(r, "cache_read_tokens")) for r in aux_rows_for_totals)
    aux_cache_write = sum(int(_num(r, "cache_write_tokens")) for r in aux_rows_for_totals)
    aux_reasoning = sum(int(_num(r, "reasoning_tokens")) for r in aux_rows_for_totals)
    aux_cost = sum(_num(r, "estimated_cost_usd") for r in aux_rows_for_totals)
    aux_actual = sum(_num(r, "actual_cost_usd") for r in aux_rows_for_totals)

    grand_input = main_input + aux_input
    grand_output = main_output + aux_output
    grand_cache_read = main_cache_read + aux_cache_read
    grand_cache_write = main_cache_write + aux_cache_write
    grand_reasoning = main_reasoning + aux_reasoning
    total_tokens = grand_input + grand_output + grand_cache_read + grand_cache_write
    cache_denominator = grand_input + grand_cache_read
    cache_hit_rate = (grand_cache_read / cache_denominator) if cache_denominator > 0 else 0.0

    totals = InsightsTotals(
        sessions=int(totals_row["sessions"]) if totals_row is not None else 0,
        messages=int(_num(totals_row, "message_count")) if totals_row is not None else 0,
        api_calls=(int(_num(totals_row, "api_call_count")) if totals_row is not None else 0)
        + sum(int(_num(r, "api_call_count")) for r in aux_rows_for_totals),
        tool_calls=int(_num(totals_row, "tool_call_count")) if totals_row is not None else 0,
        input_tokens=grand_input,
        output_tokens=grand_output,
        cache_read_tokens=grand_cache_read,
        cache_write_tokens=grand_cache_write,
        reasoning_tokens=grand_reasoning,
        total_tokens=total_tokens,
        estimated_cost_usd=main_cost + aux_cost,
        actual_cost_usd=main_actual + aux_actual,
        cache_hit_rate=cache_hit_rate,
        auxiliary_estimated_cost_usd=aux_cost,
        auxiliary_input_tokens=aux_input,
        auxiliary_output_tokens=aux_output,
    )

    daily = _daily_series(session_rows, zone, days, now)
    models, providers = _model_provider_breakdown(conn, schema, cutoff)
    sources = _source_breakdown(session_rows)
    auxiliary = _auxiliary_breakdown(conn, schema, cutoff)
    top_sessions = _top_sessions(session_rows)

    range_start: float | None
    if cutoff is not None:
        range_start = cutoff
    else:
        started = [_num(r, "started_at", 0.0) for r in session_rows if _num(r, "started_at", 0.0)]
        range_start = min(started) if started else None

    return InsightsResponse(
        days=days,
        tz=tz,
        range_start=range_start,
        range_end=now,
        totals=totals,
        daily=daily,
        models=models,
        providers=providers,
        sources=sources,
        auxiliary=auxiliary,
        top_sessions=top_sessions,
    )

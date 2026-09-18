from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra.db import Schema, StateDB
from astra.insights import InvalidTimezone, build_insights, resolve_zone


def _conn(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def test_requires_auth(client: TestClient) -> None:
    assert client.get("/api/insights").status_code == 401


def test_invalid_days_rejected(authed: TestClient) -> None:
    resp = authed.get("/api/insights", params={"days": "14"})
    assert resp.status_code == 422


def test_invalid_tz_rejected(authed: TestClient) -> None:
    resp = authed.get("/api/insights", params={"days": "30", "tz": "Not/AZone"})
    assert resp.status_code == 422


def test_resolve_zone_rejects_garbage() -> None:
    with pytest.raises(InvalidTimezone):
        resolve_zone("Not/AZone")
    resolve_zone("UTC")
    resolve_zone("America/New_York")


# -- hand-computed totals -----------------------------------------------------


def test_totals_match_hand_computed_sums(authed: TestClient, fixture_db_path: Path) -> None:
    """Independent SQL (not reusing astra.insights' query builder) reproduces the API's totals
    for days=all: main-loop sums straight off `sessions`, auxiliary sums off
    `session_model_usage` rows with a non-empty task, added on top (see astra/insights.py
    module docstring for why this isn't double-counting)."""
    conn = _conn(fixture_db_path)
    main = conn.execute(
        """SELECT COUNT(*) AS n, SUM(message_count) AS messages, SUM(tool_call_count) AS tool_calls,
                  SUM(api_call_count) AS api_calls, SUM(input_tokens) AS input_tokens,
                  SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
                  SUM(cache_write_tokens) AS cache_write_tokens, SUM(reasoning_tokens) AS reasoning_tokens,
                  SUM(estimated_cost_usd) AS estimated_cost_usd, SUM(actual_cost_usd) AS actual_cost_usd
           FROM sessions"""
    ).fetchone()
    aux = conn.execute(
        """SELECT SUM(api_call_count) AS api_calls, SUM(input_tokens) AS input_tokens,
                  SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
                  SUM(cache_write_tokens) AS cache_write_tokens,
                  SUM(estimated_cost_usd) AS estimated_cost_usd, SUM(actual_cost_usd) AS actual_cost_usd
           FROM session_model_usage WHERE task != ''"""
    ).fetchone()
    conn.close()

    expected_input = main["input_tokens"] + aux["input_tokens"]
    expected_output = main["output_tokens"] + aux["output_tokens"]
    expected_cache_read = main["cache_read_tokens"] + (aux["cache_read_tokens"] or 0)
    expected_cache_write = main["cache_write_tokens"] + (aux["cache_write_tokens"] or 0)
    expected_cost = main["estimated_cost_usd"] + aux["estimated_cost_usd"]
    expected_actual = (main["actual_cost_usd"] or 0.0) + (aux["actual_cost_usd"] or 0.0)
    expected_api_calls = main["api_calls"] + aux["api_calls"]
    expected_cache_hit_rate = expected_cache_read / (expected_input + expected_cache_read)

    body = authed.get("/api/insights", params={"days": "all", "tz": "UTC"}).json()
    totals = body["totals"]

    assert totals["sessions"] == main["n"] == 86
    assert totals["messages"] == main["messages"]
    assert totals["tool_calls"] == main["tool_calls"]
    assert totals["api_calls"] == expected_api_calls
    assert totals["input_tokens"] == expected_input
    assert totals["output_tokens"] == expected_output
    assert totals["cache_read_tokens"] == expected_cache_read
    assert totals["cache_write_tokens"] == expected_cache_write
    assert totals["estimated_cost_usd"] == pytest.approx(expected_cost)
    assert totals["actual_cost_usd"] == pytest.approx(expected_actual)
    assert totals["cache_hit_rate"] == pytest.approx(expected_cache_hit_rate)
    assert totals["auxiliary_input_tokens"] == aux["input_tokens"]
    assert totals["auxiliary_estimated_cost_usd"] == pytest.approx(aux["estimated_cost_usd"])
    # Aux is real spend layered on top of, not carved out of, sessions.* — so main-loop input
    # tokens alone must be strictly less than the combined total whenever aux usage exists.
    assert main["input_tokens"] < totals["input_tokens"]


def test_daily_bucket_hand_computed(authed: TestClient, fixture_db_path: Path) -> None:
    """Pick one concrete UTC day and verify the API's bucket for it matches a hand-rolled
    aggregation straight off `sessions.started_at`."""
    conn = _conn(fixture_db_path)
    rows = conn.execute("SELECT started_at, input_tokens, output_tokens FROM sessions").fetchall()
    conn.close()

    from collections import Counter

    by_day_sessions: Counter[str] = Counter()
    by_day_input: Counter[str] = Counter()
    for r in rows:
        day = datetime.fromtimestamp(r["started_at"], tz=UTC).strftime("%Y-%m-%d")
        by_day_sessions[day] += 1
        by_day_input[day] += r["input_tokens"] or 0

    # A day with at least one session, so the assertion is meaningful.
    target_day, expected_sessions = by_day_sessions.most_common(1)[0]
    expected_input = by_day_input[target_day]

    body = authed.get("/api/insights", params={"days": "all", "tz": "UTC"}).json()
    points = {p["date"]: p for p in body["daily"]}
    assert target_day in points
    assert points[target_day]["sessions"] == expected_sessions
    assert points[target_day]["input_tokens"] == expected_input


def test_tz_bucketing_moves_a_session_across_midnight(authed: TestClient, fixture_db_path: Path) -> None:
    """Session 0048ab216122 started 2026-05-19 23:49:30 UTC (701,607 input tokens) — it buckets
    as 2026-05-19 under UTC but crosses into 2026-05-20 under Asia/Tokyo (UTC+9, no DST), landing
    alongside session 0004a03e286c (started 2026-05-20 00:38:23 UTC, 893,317 input tokens). So the
    Tokyo '2026-05-20' bucket must include both sessions' tokens while the UTC '2026-05-20' bucket
    includes only the second — a direct, non-coincidental test of tz-aware day bucketing."""
    conn = _conn(fixture_db_path)
    row = conn.execute("SELECT id, started_at FROM sessions WHERE id = ?", ("0048ab216122",)).fetchone()
    conn.close()
    assert row is not None, "fixture DB layout changed; pick another boundary session"
    utc_day = datetime.fromtimestamp(row["started_at"], tz=UTC).strftime("%Y-%m-%d")
    tokyo_day = datetime.fromtimestamp(row["started_at"], tz=resolve_zone("Asia/Tokyo")).strftime("%Y-%m-%d")
    assert utc_day == "2026-05-19"
    assert tokyo_day == "2026-05-20"

    utc_body = authed.get("/api/insights", params={"days": "all", "tz": "UTC"}).json()
    tokyo_body = authed.get("/api/insights", params={"days": "all", "tz": "Asia/Tokyo"}).json()

    utc_points = {p["date"]: p for p in utc_body["daily"]}
    tokyo_points = {p["date"]: p for p in tokyo_body["daily"]}

    # UTC's 2026-05-20 bucket holds only session 0004a03e286c (893,317 input tokens).
    assert utc_points["2026-05-20"]["input_tokens"] == 893317
    # Tokyo's 2026-05-20 bucket gains 0048ab216122 (701,607) on top of that.
    assert tokyo_points["2026-05-20"]["input_tokens"] == 893317 + 701607
    assert tokyo_points["2026-05-20"]["sessions"] == utc_points["2026-05-20"]["sessions"] + 1


def test_numeric_days_window_is_exclusive_boundary(authed: TestClient) -> None:
    body_1 = authed.get("/api/insights", params={"days": "1"}).json()
    body_all = authed.get("/api/insights", params={"days": "all"}).json()
    assert len(body_1["daily"]) == 1
    assert body_1["totals"]["sessions"] <= body_all["totals"]["sessions"]


def test_top_sessions_sorted_by_cost_desc(authed: TestClient) -> None:
    body = authed.get("/api/insights", params={"days": "all"}).json()
    costs = [s["estimated_cost_usd"] or 0.0 for s in body["top_sessions"]]
    assert costs == sorted(costs, reverse=True)
    assert len(body["top_sessions"]) <= 10


def test_sources_cover_expected_buckets(authed: TestClient) -> None:
    body = authed.get("/api/insights", params={"days": "all"}).json()
    sources = {s["source"] for s in body["sources"]}
    assert sources <= {"webui", "discord", "cron", "cli", "subagent", "tui", "unknown"}
    assert "subagent" in sources  # fixture has subagent sessions; must get their own bucket


def test_auxiliary_tasks_present_and_not_in_models(authed: TestClient) -> None:
    body = authed.get("/api/insights", params={"days": "all"}).json()
    tasks = {t["task"] for t in body["auxiliary"]}
    assert tasks == {"approval", "title_generation", "background_review", "compression", "vision"}


def test_response_shape(authed: TestClient) -> None:
    body = authed.get("/api/insights", params={"days": "7"}).json()
    assert body["days"] == "7"
    assert body["tz"] == "UTC"
    assert set(body["totals"]) == {
        "sessions", "messages", "api_calls", "tool_calls", "input_tokens", "output_tokens",
        "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "total_tokens",
        "estimated_cost_usd", "actual_cost_usd", "cache_hit_rate",
        "auxiliary_estimated_cost_usd", "auxiliary_input_tokens", "auxiliary_output_tokens",
    }


# -- direct unit tests on build_insights (bypassing HTTP) --------------------


def test_missing_session_model_usage_falls_back_gracefully(fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    full = db.introspect()
    reduced = Schema({"sessions": full.table("sessions"), "messages": full.table("messages")})
    with db.connection() as conn:
        report = build_insights(conn, reduced, days="all", tz="UTC")
    db.close()
    assert report.auxiliary == []
    assert len(report.models) > 0  # falls back to sessions.model
    assert report.totals.sessions == 86


def test_days_all_range_start_is_earliest_session(fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    schema = db.introspect()
    with db.connection() as conn:
        report = build_insights(conn, schema, days="all", tz="UTC")
        row = conn.execute("SELECT MIN(started_at) AS m FROM sessions").fetchone()
    db.close()
    assert report.range_start == pytest.approx(row["m"])

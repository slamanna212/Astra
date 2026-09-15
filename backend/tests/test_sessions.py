from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from astra.db import Schema, StateDB
from astra.sessions import ListParams, build_list_query, list_sessions


def _all_rows(db_path: Path) -> list[dict[str, Any]]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT id, source, pinned, archived, hidden, started_at, last_activity_at FROM sessions")]
    conn.close()
    return rows


def _expected_order(rows: list[dict[str, Any]], pinned_first: bool = True) -> list[str]:
    def key(r: dict[str, Any]) -> tuple[Any, ...]:
        activity = r["last_activity_at"] if r["last_activity_at"] is not None else r["started_at"]
        pinned = 1 if (pinned_first and r["pinned"]) else 0
        return (pinned, activity, r["id"])

    return [r["id"] for r in sorted(rows, key=key, reverse=True)]


def _walk(client: TestClient, **params: Any) -> tuple[list[dict[str, Any]], int]:
    items: list[dict[str, Any]] = []
    cursor = None
    pages = 0
    while True:
        q = dict(params)
        if cursor:
            q["cursor"] = cursor
        resp = client.get("/api/sessions", params=q)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        items.extend(body["items"])
        pages += 1
        cursor = body["next_cursor"]
        if not cursor:
            break
        assert pages < 1000
    return items, pages


def test_pagination_walks_everything_in_order(authed: TestClient, fixture_db_path: Path) -> None:
    rows = _all_rows(fixture_db_path)
    items, pages = _walk(authed, limit=7, include_archived=True, include_hidden=True)
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)) == len(rows) == 86
    assert ids == _expected_order(rows)
    assert pages == -(-86 // 7)


def test_pinned_first_false_order(authed: TestClient, fixture_db_path: Path) -> None:
    rows = _all_rows(fixture_db_path)
    items, _ = _walk(authed, limit=10, include_archived=True, include_hidden=True, pinned_first=False)
    assert [i["id"] for i in items] == _expected_order(rows, pinned_first=False)


def test_default_excludes_archived_and_hidden(authed: TestClient, fixture_db_path: Path) -> None:
    rows = _all_rows(fixture_db_path)
    items, _ = _walk(authed, limit=50)
    visible = [r for r in rows if not r["archived"] and not r["hidden"]]
    assert {i["id"] for i in items} == {r["id"] for r in visible}
    assert all(not i["archived"] and not i["hidden"] for i in items)

    only_archived, _ = _walk(authed, limit=50, include_archived=True)
    assert {i["id"] for i in only_archived} == {r["id"] for r in rows if not r["hidden"]}


def test_source_filter_repeatable(authed: TestClient, fixture_db_path: Path) -> None:
    rows = _all_rows(fixture_db_path)
    items, _ = _walk(authed, limit=5, source=["cli", "tui"], include_archived=True, include_hidden=True)
    assert {i["id"] for i in items} == {r["id"] for r in rows if r["source"] in {"cli", "tui"}}
    assert {i["source"] for i in items} == {"cli", "tui"}


def test_summary_shape(authed: TestClient) -> None:
    body = authed.get("/api/sessions", params={"limit": 1}).json()
    item = body["items"][0]
    assert set(item) == {
        "id", "title", "display_name", "source", "model", "started_at", "last_activity_at",
        "ended_at", "message_count", "tool_call_count", "input_tokens", "output_tokens",
        "estimated_cost_usd", "pinned", "archived", "hidden", "parent_session_id",
        "last_activity_description",
    }
    assert isinstance(item["started_at"], float)
    assert isinstance(item["pinned"], bool)
    assert body["next_cursor"]


def test_pinned_rows_come_first(authed: TestClient) -> None:
    items = authed.get("/api/sessions", params={"limit": 200, "include_archived": True, "include_hidden": True}).json()["items"]
    flags = [i["pinned"] for i in items]
    assert any(flags)
    assert flags == sorted(flags, reverse=True)


def test_limit_bounds(authed: TestClient) -> None:
    assert authed.get("/api/sessions", params={"limit": 0}).status_code == 422
    assert authed.get("/api/sessions", params={"limit": 201}).status_code == 422
    assert len(authed.get("/api/sessions", params={"limit": 200, "include_archived": True, "include_hidden": True}).json()["items"]) == 86
    assert len(authed.get("/api/sessions").json()["items"]) == 50


def test_bad_cursors(authed: TestClient) -> None:
    assert authed.get("/api/sessions", params={"cursor": "not-a-cursor!!"}).status_code == 400
    cursor = authed.get("/api/sessions", params={"limit": 5}).json()["next_cursor"]
    # Cursor issued for different filters is refused rather than silently skipping rows.
    assert authed.get("/api/sessions", params={"limit": 5, "cursor": cursor, "include_archived": True}).status_code == 400
    assert authed.get("/api/sessions", params={"limit": 5, "cursor": cursor}).status_code == 200


def test_detail_and_404(authed: TestClient, fixture_db_path: Path) -> None:
    sid = _all_rows(fixture_db_path)[0]["id"]
    resp = authed.get(f"/api/sessions/{sid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == sid
    for forbidden in ("system_prompt", "system_prompt_hash", "model_config", "origin_json", "session_key", "user_id", "chat_id", "billing_base_url"):
        assert forbidden not in body
    assert "cache_read_tokens" in body
    assert authed.get("/api/sessions/does-not-exist").status_code == 404


def test_query_adapts_to_missing_columns(fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    full = db.introspect()
    reduced = Schema({
        "sessions": full.table("sessions") - {"pinned", "hidden", "last_activity_at", "title", "estimated_cost_usd"},
        "messages": full.table("messages"),
    })
    with db.connection() as conn:
        items, cursor = list_sessions(conn, reduced, ListParams(limit=10))
        assert len(items) == 10 and cursor
        assert all(i.title is None and i.pinned is False for i in items)
        more, _ = list_sessions(conn, reduced, ListParams(limit=10, cursor=cursor))
        assert not ({i.id for i in items} & {i.id for i in more})
    db.close()


def test_connection_is_read_only(fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    with db.connection() as conn:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("UPDATE sessions SET title = 'x' WHERE 0")
    db.close()


def test_query_plan_is_single_scan(fixture_db_path: Path) -> None:
    """No index on last_activity_at exists (and we may not add one): expect one scan + sort,
    never a nested loop or correlated subquery."""
    db = StateDB(fixture_db_path)
    schema = db.introspect()
    sql, args = build_list_query(schema, ListParams(limit=50))
    with db.connection() as conn:
        plan = [r["detail"] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args)]
    db.close()
    assert len([p for p in plan if p.startswith(("SCAN", "SEARCH"))]) == 1, plan
    assert not any("CORRELATED" in p for p in plan), plan


def test_missing_state_db(make_client: Any, tmp_path: Path) -> None:
    c = make_client(hermes_home=tmp_path)
    assert c.get("/api/health").json()["state_db"] == {"ok": False}
    from .conftest import login

    login(c)
    assert c.get("/api/sessions").status_code == 503
    assert not (tmp_path / "state.db").exists()

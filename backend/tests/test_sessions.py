from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from astra.db import Schema, StateDB
from astra.sessions import ListParams, build_list_query, list_sessions

from .conftest import CSRF


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
    assert len(rows) == 86
    # No explicit source filter: default listing hides subagent sessions (they're rendered
    # nested under their parent in the sidebar instead of as top-level rows).
    visible = [r for r in rows if r["source"] != "subagent"]
    items, pages = _walk(authed, limit=7, status="all")
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)) == len(visible) == 80
    assert ids == _expected_order(visible)
    assert pages == -(-80 // 7)


def test_pinned_first_false_order(authed: TestClient, fixture_db_path: Path) -> None:
    rows = [r for r in _all_rows(fixture_db_path) if r["source"] != "subagent"]
    items, _ = _walk(authed, limit=10, status="all", pinned_first=False)
    assert [i["id"] for i in items] == _expected_order(rows, pinned_first=False)


def test_default_excludes_archived_and_hidden(authed: TestClient, fixture_db_path: Path) -> None:
    rows = [r for r in _all_rows(fixture_db_path) if r["source"] != "subagent"]
    items, _ = _walk(authed, limit=50)
    visible = [r for r in rows if not r["archived"] and not r["hidden"]]
    assert {i["id"] for i in items} == {r["id"] for r in visible}
    assert all(not i["archived"] and not i["hidden"] for i in items)

    only_archived, _ = _walk(authed, limit=50, status="archived")
    assert {i["id"] for i in only_archived} == {r["id"] for r in rows if r["archived"]}
    assert all(i["archived"] for i in only_archived)

    only_hidden, _ = _walk(authed, limit=50, status="hidden")
    assert {i["id"] for i in only_hidden} == {r["id"] for r in rows if r["hidden"]}
    assert all(i["hidden"] for i in only_hidden)


def test_count_endpoint_matches_listing(authed: TestClient, fixture_db_path: Path) -> None:
    rows = [r for r in _all_rows(fixture_db_path) if r["source"] != "subagent"]

    resp = authed.get("/api/sessions/count", params={"status": "archived"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"count": sum(1 for r in rows if r["archived"])}

    resp = authed.get("/api/sessions/count", params={"status": "active"})
    assert resp.json() == {"count": sum(1 for r in rows if not r["archived"] and not r["hidden"])}

    only_archived, _ = _walk(authed, limit=50, status="archived")
    resp = authed.get("/api/sessions/count", params={"status": "archived"})
    assert resp.json()["count"] == len(only_archived)


def test_default_listing_excludes_subagent_but_source_filter_returns_them(
    authed: TestClient, fixture_db_path: Path
) -> None:
    rows = _all_rows(fixture_db_path)
    subagent_ids = {r["id"] for r in rows if r["source"] == "subagent"}
    assert subagent_ids  # fixture has subagent rows; the test is meaningless otherwise

    items, _ = _walk(authed, limit=50, status="all")
    assert not ({i["id"] for i in items} & subagent_ids)
    assert all(i["source"] != "subagent" for i in items)

    only_subagent, _ = _walk(authed, limit=50, status="all", source=["subagent"])
    assert {i["id"] for i in only_subagent} == subagent_ids
    assert all(i["source"] == "subagent" for i in only_subagent)


def test_source_filter_repeatable(authed: TestClient, fixture_db_path: Path) -> None:
    rows = _all_rows(fixture_db_path)
    items, _ = _walk(authed, limit=5, source=["cli", "tui"], status="all")
    assert {i["id"] for i in items} == {r["id"] for r in rows if r["source"] in {"cli", "tui"}}
    assert {i["source"] for i in items} == {"cli", "tui"}


def test_summary_shape(authed: TestClient) -> None:
    body = authed.get("/api/sessions", params={"limit": 1}).json()
    item = body["items"][0]
    assert set(item) == {
        "id", "title", "display_name", "source", "model", "started_at", "last_activity_at",
        "ended_at", "message_count", "tool_call_count", "input_tokens", "output_tokens",
        "estimated_cost_usd", "pinned", "archived", "hidden", "parent_session_id",
        "last_activity_description", "child_count",
    }
    assert isinstance(item["child_count"], int)
    assert isinstance(item["started_at"], float)
    assert isinstance(item["pinned"], bool)
    assert body["next_cursor"]


def test_pinned_rows_come_first(authed: TestClient) -> None:
    items = authed.get("/api/sessions", params={"limit": 200, "status": "all"}).json()["items"]
    flags = [i["pinned"] for i in items]
    assert any(flags)
    assert flags == sorted(flags, reverse=True)


def test_limit_bounds(authed: TestClient) -> None:
    assert authed.get("/api/sessions", params={"limit": 0}).status_code == 422
    assert authed.get("/api/sessions", params={"limit": 201}).status_code == 422
    # 86 fixture rows minus 6 subagent rows hidden from the default (no source filter) listing.
    assert len(authed.get("/api/sessions", params={"limit": 200, "status": "all"}).json()["items"]) == 80
    assert len(authed.get("/api/sessions").json()["items"]) == 50


def test_bad_cursors(authed: TestClient) -> None:
    assert authed.get("/api/sessions", params={"cursor": "not-a-cursor!!"}).status_code == 400
    cursor = authed.get("/api/sessions", params={"limit": 5}).json()["next_cursor"]
    # Cursor issued for different filters is refused rather than silently skipping rows.
    assert authed.get("/api/sessions", params={"limit": 5, "cursor": cursor, "status": "all"}).status_code == 400
    assert authed.get("/api/sessions", params={"limit": 5, "cursor": cursor}).status_code == 200


def test_status_rejects_unknown_value(authed: TestClient) -> None:
    assert authed.get("/api/sessions", params={"status": "bogus"}).status_code == 422


def test_detail_and_404(authed: TestClient, fixture_db_path: Path) -> None:
    sid = _all_rows(fixture_db_path)[0]["id"]
    resp = authed.get(f"/api/sessions/{sid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == sid
    for forbidden in ("system_prompt", "system_prompt_hash", "model_config", "origin_json", "session_key", "user_id", "chat_id", "billing_base_url"):
        assert forbidden not in body
    assert "cache_read_tokens" in body
    assert body["context_tokens"] > 0
    assert body["context_tokens_estimated"] is True
    assert body["context_length"] is None
    assert authed.get("/api/sessions/does-not-exist").status_code == 404


def test_delete_refuses_an_active_turn(authed: TestClient, fixture_db_path: Path) -> None:
    sid = _all_rows(fixture_db_path)[0]["id"]
    authed.app.state.ctx.chat.is_running = AsyncMock(return_value=True)
    from .conftest import CSRF

    response = authed.delete(f"/api/sessions/{sid}", headers=CSRF)
    assert response.status_code == 409
    assert "active turn" in response.json()["detail"]


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
    with db.connection() as conn, pytest.raises(sqlite3.OperationalError):
        conn.execute("UPDATE sessions SET title = 'x' WHERE 0")
    db.close()


def test_child_count(make_client: Any, fixture_db_path: Path, tmp_path: Path) -> None:
    """child_count reflects the number of source='subagent' sessions with parent_session_id
    pointing at this row (the fixture DB has zero parent/child links by default, so this seeds
    some directly). A non-subagent row pointing at the same parent (e.g. a fork) must not count."""
    home = tmp_path / "home"
    home.mkdir()
    shutil.copy2(fixture_db_path, home / "state.db")
    # Non-subagent rows only, so the parents are guaranteed visible in the default listing.
    rows = [r for r in _all_rows(fixture_db_path) if r["source"] != "subagent"]
    (
        parent_with_children,
        parent_with_one,
        parent_with_none,
        child_a,
        child_b,
        child_c,
        non_subagent_child,
    ) = (r["id"] for r in rows[:7])

    conn = sqlite3.connect(home / "state.db")
    conn.execute(
        "UPDATE sessions SET parent_session_id = ?, source = 'subagent' WHERE id IN (?, ?)",
        (parent_with_children, child_a, child_b),
    )
    conn.execute(
        "UPDATE sessions SET parent_session_id = ?, source = 'subagent' WHERE id = ?",
        (parent_with_one, child_c),
    )
    # Points at parent_with_children too, but keeps its original (non-subagent) source — e.g. a
    # forked session. Must not inflate parent_with_children's count past 2.
    conn.execute(
        "UPDATE sessions SET parent_session_id = ? WHERE id = ?",
        (parent_with_children, non_subagent_child),
    )
    conn.commit()
    conn.close()

    from .conftest import login

    client = make_client(hermes_home=home)
    login(client)
    body = client.get("/api/sessions", params={"limit": 200, "status": "all"}).json()
    by_id = {i["id"]: i for i in body["items"]}

    assert by_id[parent_with_children]["child_count"] == 2
    assert by_id[parent_with_one]["child_count"] == 1
    assert by_id[parent_with_none]["child_count"] == 0


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


def test_session_crud_uses_canonical_state_db(
    make_client: Any, fixture_db_path: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Writes are isolated to a copied canonical DB and remain visible to read-only endpoints."""
    home = tmp_path / "home"
    home.mkdir()
    shutil.copy2(fixture_db_path, home / "state.db")
    class FakeSessionDB:
        def __init__(self, path):
            self.conn = sqlite3.connect(path)

        def close(self):
            self.conn.close()

        def create_session(self, session_id, source, **kwargs):
            self.conn.execute(
                "INSERT INTO sessions (id, source, model, started_at, last_activity_at) VALUES (?, ?, ?, 1, 1)",
                (session_id, source, kwargs.get("model")),
            )
            self.conn.commit()
            return session_id

        def _set(self, session_id, column, value):
            cur = self.conn.execute(f"UPDATE sessions SET {column} = ? WHERE id = ?", (value, session_id))
            self.conn.commit()
            return cur.rowcount > 0

        def set_session_title(self, session_id, value): return self._set(session_id, "title", value)
        def set_session_pinned(self, session_id, value): return self._set(session_id, "pinned", value)
        def set_session_archived(self, session_id, value): return self._set(session_id, "archived", value)
        def set_session_hidden(self, session_id, value): return self._set(session_id, "hidden", value)

        def delete_session(self, session_id):
            cur = self.conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            self.conn.commit()
            return cur.rowcount > 0

    monkeypatch.setattr("astra.routes.sessions.session_db_class", lambda: FakeSessionDB)
    client = make_client(hermes_home=home)
    from .conftest import CSRF, login

    login(client)
    created = client.post(
        "/api/sessions", json={"title": "Astra CRUD test"}, headers=CSRF
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]
    assert created.json()["source"] == "webui"

    updated = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "Renamed", "pinned": True, "archived": True},
        headers=CSRF,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "Renamed"
    assert updated.json()["pinned"] is True
    assert updated.json()["archived"] is True

    deleted = client.delete(f"/api/sessions/{session_id}", headers=CSRF)
    assert deleted.status_code == 204, deleted.text
    assert client.get(f"/api/sessions/{session_id}").status_code == 404


def test_fork_copies_through_selected_message(
    authed: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class ForkDB:
        fork_id: str | None = None
        copied: list[dict[str, Any]] = []

        def __init__(self, _path) -> None:
            pass

        def close(self) -> None:
            pass

        def get_session(self, session_id: str):
            assert session_id == "source-session"
            return {"id": session_id, "title": "Original", "model": "test-model", "system_prompt": "system"}

        def get_messages(self, session_id: str, include_compacted: bool):
            assert session_id == "source-session" and include_compacted
            return [
                {"id": 1, "role": "user", "content": "one"},
                {"id": 2, "role": "assistant", "content": "two"},
                {"id": 3, "role": "user", "content": "three"},
            ]

        def create_session(self, session_id: str, source: str, **kwargs) -> None:
            assert source == "webui"
            assert kwargs["parent_session_id"] == "source-session"
            self.fork_id = session_id

        def replace_messages(self, session_id: str, messages: list[dict[str, Any]]) -> None:
            assert session_id == self.fork_id
            self.copied = messages

        def get_next_title_in_lineage(self, base: str) -> str:
            assert base == "Original"
            return "Original #2"

        def set_session_title(self, session_id: str, title: str) -> None:
            assert session_id == self.fork_id and title == "Original #2"

        def delete_session(self, _session_id: str) -> None:
            raise AssertionError("successful fork must not be deleted")

    fake = ForkDB(None)
    monkeypatch.setattr("astra.routes.sessions.session_db_class", lambda: lambda _path: fake)

    original_run = authed.app.state.ctx.db.run_with_schema

    async def detail_after_fork(_operation):
        return {
            "id": fake.fork_id,
            "title": "Original #2",
            "display_name": None,
            "source": "webui",
            "model": "test-model",
            "started_at": 1,
            "last_activity_at": 1,
            "ended_at": None,
            "message_count": 2,
            "tool_call_count": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "estimated_cost_usd": None,
            "pinned": False,
            "archived": False,
            "hidden": False,
            "parent_session_id": "source-session",
            "last_activity_description": None,
            "child_count": 0,
        }

    authed.app.state.ctx.db.run_with_schema = detail_after_fork
    try:
        response = authed.post(
            "/api/sessions/source-session/fork", json={"message_id": 2}, headers=CSRF
        )
    finally:
        authed.app.state.ctx.db.run_with_schema = original_run

    assert response.status_code == 201, response.text
    assert response.json()["parent_session_id"] == "source-session"
    assert [message["id"] for message in fake.copied] == [1, 2]

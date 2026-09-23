from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from astra.db import StateDB
from astra.messages import WindowParams, get_window

BIG_SESSION = "00001246c0a6"  # the fixture's 4,413-message conversation


def _all_visible_ids(db_path: Path, session_id: str) -> list[int]:
    db = StateDB(db_path)
    schema = db.introspect()
    with db.connection() as conn:
        ids: list[int] = []
        cursor = 0
        while True:
            page = get_window(conn, schema, session_id, WindowParams(limit=500, after_id=cursor))
            if not page.items:
                break
            ids.extend(m.id for m in page.items)
            cursor = page.newest_id
            if not page.has_newer:
                break
    db.close()
    return ids


def test_window_walks_forward_with_no_gaps_or_dups(authed: TestClient) -> None:
    seen: list[int] = []
    cursor = 0
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 300, "after_id": cursor}
        resp = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        seen.extend(m["id"] for m in body["items"])
        pages += 1
        assert pages < 100
        if not body["has_newer"]:
            break
        cursor = body["newest_id"]
    assert len(seen) == len(set(seen))
    assert seen == sorted(seen)
    assert len(seen) > 1000  # well into the 4,413-row conversation


def test_window_walks_backward_matches_forward(authed: TestClient, fixture_db_path: Path) -> None:
    forward = _all_visible_ids(fixture_db_path, BIG_SESSION)

    seen: list[int] = []
    resp = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 300})
    body = resp.json()
    seen = [m["id"] for m in body["items"]]
    cursor = body["oldest_id"]
    has_older = body["has_older"]
    pages = 1
    while has_older:
        resp = authed.get(
            f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 300, "before_id": cursor}
        )
        body = resp.json()
        seen = [m["id"] for m in body["items"]] + seen
        cursor = body["oldest_id"]
        has_older = body["has_older"]
        pages += 1
        assert pages < 100
    assert seen == sorted(seen)
    assert len(seen) == len(set(seen))
    assert seen == forward


def test_default_window_is_latest(authed: TestClient) -> None:
    body = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 50}).json()
    assert body["has_newer"] is False
    assert len(body["items"]) == 50
    assert [m["id"] for m in body["items"]] == sorted(m["id"] for m in body["items"])


def test_around_id_centers_window(authed: TestClient) -> None:
    latest = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 1}).json()
    newest_id = latest["newest_id"]
    target = newest_id - 500

    body = authed.get(
        f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 40, "around_id": target}
    ).json()
    ids = [m["id"] for m in body["items"]]
    assert target in ids
    assert ids == sorted(ids)
    # Roughly centered: some ids on both sides of the target.
    assert min(ids) < target < max(ids)


def test_around_id_missing_message_404s(authed: TestClient) -> None:
    resp = authed.get(
        f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 10, "around_id": 999_999_999}
    )
    assert resp.status_code == 404


def test_unknown_session_404s(authed: TestClient) -> None:
    assert authed.get("/api/sessions/does-not-exist/messages").status_code == 404
    assert authed.get("/api/sessions/does-not-exist/messages/1").status_code == 404


def test_multiple_cursor_kinds_rejected(authed: TestClient) -> None:
    resp = authed.get(
        f"/api/sessions/{BIG_SESSION}/messages",
        params={"before_id": 5, "after_id": 10},
    )
    assert resp.status_code == 422


def test_limit_bounds(authed: TestClient) -> None:
    assert authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 0}).status_code == 422
    assert authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 501}).status_code == 422


def test_message_shape(authed: TestClient) -> None:
    body = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 5}).json()
    item = body["items"][0]
    assert set(item) == {
        "id", "role", "content", "truncated", "tool_calls", "tool_call_id", "tool_name",
        "timestamp", "token_count", "finish_reason", "reasoning", "commentary", "display_kind",
        "display_metadata", "effect_disposition", "active", "compacted",
    }
    for forbidden in ("api_content", "codex_reasoning_items", "codex_message_items", "session_id"):
        assert forbidden not in item


def test_full_message_fetch_and_404(authed: TestClient) -> None:
    body = authed.get(f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 1}).json()
    mid = body["items"][0]["id"]
    resp = authed.get(f"/api/sessions/{BIG_SESSION}/messages/{mid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == mid
    assert authed.get(f"/api/sessions/{BIG_SESSION}/messages/999999999").status_code == 404


def test_truncation_and_full_fetch_are_consistent(authed: TestClient, fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    with db.connection() as conn:
        row = conn.execute(
            "SELECT session_id, id, length(content) AS len FROM messages "
            "ORDER BY length(content) DESC LIMIT 1"
        ).fetchone()
    db.close()
    sid, mid, length = row["session_id"], row["id"], row["len"]

    full = authed.get(f"/api/sessions/{sid}/messages/{mid}").json()
    assert full["truncated"] is False
    if length is not None and isinstance(full["content"], str):
        assert len(full["content"].encode("utf-8")) == length

    windowed = authed.get(
        f"/api/sessions/{sid}/messages", params={"limit": 500, "around_id": mid}
    ).json()
    item = next(m for m in windowed["items"] if m["id"] == mid)
    if length and length > 64 * 1024:
        assert item["truncated"] is True
        assert isinstance(item["content"], str)
        assert len(item["content"].encode("utf-8")) <= 64 * 1024
    else:
        assert item["content"] == full["content"]


def test_tool_call_pairing_ids_present(authed: TestClient, fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    with db.connection() as conn:
        row = conn.execute(
            "SELECT session_id, id FROM messages WHERE tool_calls IS NOT NULL LIMIT 1"
        ).fetchone()
    db.close()
    if row is None:
        pytest.skip("fixture has no assistant tool_calls rows")
    sid, mid = row["session_id"], row["id"]
    body = authed.get(f"/api/sessions/{sid}/messages", params={"limit": 500, "around_id": mid}).json()
    item = next(m for m in body["items"] if m["id"] == mid)
    assert item["tool_calls"]
    for call in item["tool_calls"]:
        assert call["id"]


def test_include_inactive_returns_at_least_as_many_rows(authed: TestClient, fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    with db.connection() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?", (BIG_SESSION,)
        ).fetchone()[0]
    db.close()

    default_count = 0
    cursor = 0
    while True:
        body = authed.get(
            f"/api/sessions/{BIG_SESSION}/messages", params={"limit": 500, "after_id": cursor}
        ).json()
        default_count += len(body["items"])
        if not body["has_newer"]:
            break
        cursor = body["newest_id"]

    inactive_count = 0
    cursor = 0
    while True:
        body = authed.get(
            f"/api/sessions/{BIG_SESSION}/messages",
            params={"limit": 500, "after_id": cursor, "include_inactive": True},
        ).json()
        inactive_count += len(body["items"])
        if not body["has_newer"]:
            break
        cursor = body["newest_id"]

    assert inactive_count == total
    assert inactive_count >= default_count


def test_children_endpoint_returns_subagent_sessions(make_client: Any, fixture_db_path: Path, tmp_path: Path) -> None:
    """The /children endpoint returns only source='subagent' rows pointing at the parent — a
    non-subagent row (e.g. a fork) with the same parent_session_id must not appear (it's already
    shown as its own top-level session)."""
    home = tmp_path / "home"
    home.mkdir()
    shutil.copy2(fixture_db_path, home / "state.db")

    db = StateDB(fixture_db_path)
    with db.connection() as conn:
        rows = conn.execute("SELECT id, source FROM sessions LIMIT 3").fetchall()
    db.close()
    parent_id, subagent_child, non_subagent_child = (r["id"] for r in rows)

    conn = sqlite3.connect(home / "state.db")
    conn.execute(
        "UPDATE sessions SET parent_session_id = ?, source = 'subagent' WHERE id = ?",
        (parent_id, subagent_child),
    )
    conn.execute(
        "UPDATE sessions SET parent_session_id = ? WHERE id = ?",
        (parent_id, non_subagent_child),
    )
    conn.commit()
    conn.close()

    from .conftest import login

    client = make_client(hermes_home=home)
    login(client)
    body = client.get(f"/api/sessions/{parent_id}/children").json()
    assert [c["id"] for c in body["items"]] == [subagent_child]


def test_children_endpoint_unknown_session_returns_empty(authed: TestClient) -> None:
    body = authed.get("/api/sessions/does-not-exist/children").json()
    assert body == {"items": []}


def test_query_plan_uses_index(fixture_db_path: Path) -> None:
    db = StateDB(fixture_db_path)
    schema = db.introspect()
    from astra.messages import _select_columns, _visibility_expr

    cols = _select_columns(schema)
    visible = _visibility_expr(schema, False)
    sql = (
        f"SELECT {cols} FROM messages WHERE session_id = ? AND id < ? AND {visible} "
        "ORDER BY id DESC LIMIT ?"
    )
    with db.connection() as conn:
        plan = [r["detail"] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, (BIG_SESSION, 10**9, 200))]
    db.close()
    assert any("USING INDEX idx_messages_session_id" in p for p in plan), plan
    assert not any(p.startswith("SCAN") for p in plan), plan



def test_codex_commentary_extracted_and_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    from astra import messages

    monkeypatch.setattr(messages, "redact_sensitive_text", lambda text: text.replace("SECRET", "***"))
    items = [
        {"type": "reasoning", "summary": []},
        {"type": "message", "phase": "analysis", "content": [{"type": "output_text", "text": "scratchpad"}]},
        {"type": "message", "phase": "commentary", "content": [{"type": "output_text", "text": "PR #128 is open."}]},
        {"type": "message", "phase": "Commentary ", "content": [{"type": "output_text", "text": "Token SECRET set."}]},
    ]
    assert messages._extract_commentary(json.dumps(items)) == "PR #128 is open.\n\nToken *** set."
    assert messages._extract_commentary(None) is None
    assert messages._extract_commentary("not json") is None
    assert messages._extract_commentary(json.dumps([{"type": "message", "phase": "final_answer", "content": []}])) is None

    # Fail closed: no redactor available means no commentary, never unredacted text.
    monkeypatch.setattr(messages, "redact_sensitive_text", lambda text: None)
    assert messages._extract_commentary(json.dumps(items)) is None

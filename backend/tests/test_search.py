from __future__ import annotations

from fastapi.testclient import TestClient

from astra.search import SNIPPET_END, SNIPPET_START, sanitize_query


def test_sanitize_query_strips_operators() -> None:
    assert sanitize_query('foo bar') == '"foo" "bar"'
    assert sanitize_query('NEAR foo') == '"NEAR" "foo"'
    assert sanitize_query('(foo OR bar)') == '"foo" "OR" "bar"'
    assert sanitize_query('foo*') == '"foo"'
    assert sanitize_query('"quoted phrase"') == '"quoted" "phrase"'
    assert sanitize_query('') is None
    assert sanitize_query('   ') is None
    assert sanitize_query('***???') is None


def test_search_empty_query_returns_empty(authed: TestClient) -> None:
    body = authed.get("/api/search", params={"q": ""}).json()
    assert body == {"items": [], "next_cursor": None}


def test_search_operator_like_query_does_not_error(authed: TestClient) -> None:
    for q in ['NEAR "x"', "(a OR b)", "a*", "a AND b", "**"]:
        resp = authed.get("/api/search", params={"q": q})
        assert resp.status_code == 200, (q, resp.text)


def test_search_finds_hits_with_snippet_markers(authed: TestClient) -> None:
    resp = authed.get("/api/search", params={"q": "the", "limit": 10})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) > 0
    hit = body["items"][0]
    assert {"session_id", "session_title", "source", "message_id", "role", "timestamp", "snippet"} <= set(hit)
    assert SNIPPET_START in hit["snippet"] or hit["role"] == "session_title"


def test_search_pagination_no_dups(authed: TestClient) -> None:
    seen: list[tuple[str, object]] = []
    cursor = None
    pages = 0
    while True:
        params = {"q": "the", "limit": 15}
        if cursor:
            params["cursor"] = cursor
        resp = authed.get("/api/search", params=params)
        assert resp.status_code == 200
        body = resp.json()
        seen.extend((h["session_id"], h["message_id"]) for h in body["items"])
        cursor = body["next_cursor"]
        pages += 1
        if not cursor or pages > 20:
            break
    assert len(seen) == len(set(seen))


def test_search_cursor_bound_to_query(authed: TestClient) -> None:
    body = authed.get("/api/search", params={"q": "the", "limit": 3}).json()
    cursor = body["next_cursor"]
    assert cursor
    ok = authed.get("/api/search", params={"q": "the", "limit": 3, "cursor": cursor})
    assert ok.status_code == 200
    mismatched = authed.get("/api/search", params={"q": "config", "limit": 3, "cursor": cursor})
    assert mismatched.status_code == 400


def test_search_bad_cursor_400(authed: TestClient) -> None:
    resp = authed.get("/api/search", params={"q": "the", "cursor": "not-a-cursor!!"})
    assert resp.status_code == 400


def test_search_matches_session_titles(authed: TestClient) -> None:
    body = authed.get("/api/search", params={"q": "network scan", "limit": 50}).json()
    assert any(h["role"] == "session_title" for h in body["items"])


def test_search_source_filter(authed: TestClient) -> None:
    body = authed.get("/api/search", params={"q": "the", "source": "cli", "limit": 20}).json()
    for hit in body["items"]:
        if hit["role"] != "session_title":
            assert hit["source"] == "cli"


def test_snippet_markers_are_sentinel_not_html() -> None:
    assert "<mark>" not in SNIPPET_START
    assert SNIPPET_START != "<mark>"
    assert SNIPPET_END != "</mark>"

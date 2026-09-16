from __future__ import annotations

from astra.openviking import OpenVikingClient, OpenVikingUnavailable

from .conftest import CSRF, login


def test_openviking_routes_require_login(client):
    assert client.get("/api/openviking/status").status_code == 401


def test_openviking_unavailable_is_distinct_from_empty(authed, monkeypatch):
    async def unavailable(self, *args, **kwargs):
        raise OpenVikingUnavailable("OpenViking is unreachable")

    monkeypatch.setattr(OpenVikingClient, "request", unavailable)
    response = authed.get("/api/openviking/status")
    assert response.status_code == 503
    assert response.json()["detail"] == "OpenViking is unreachable"


def test_openviking_tree_uses_hidden_files_and_nonrecursive(authed, monkeypatch):
    calls = []

    async def fake(self, method, path, **kwargs):
        calls.append((method, path, kwargs))
        return [{"name": ".overview.md", "uri": "viking://user/default/.overview.md", "isDir": False}]

    monkeypatch.setattr(OpenVikingClient, "request", fake)
    response = authed.get("/api/openviking/tree", params={"uri": "viking://user/default"})
    assert response.status_code == 200
    assert response.json()["items"][0]["name"] == ".overview.md"
    assert calls == [("GET", "/api/v1/fs/ls", {"params": {"uri": "viking://user/default", "show_all_hidden": True, "recursive": False, "output": "agent", "abs_limit": 256}})]


def test_openviking_tree_normalizes_directory_shape(authed, monkeypatch):
    async def fake(self, method, path, **kwargs):
        return {"children": [{"name": "memories", "uri": "viking://user/default/memories", "type": "directory"}]}

    monkeypatch.setattr(OpenVikingClient, "request", fake)
    response = authed.get("/api/openviking/tree", params={"uri": "viking://user/default"})
    assert response.status_code == 200
    assert response.json()["items"][0]["isDir"] is True


def test_openviking_content_forwards_page_and_exposes_next_page(authed, monkeypatch):
    calls = []

    async def fake(self, method, path, **kwargs):
        calls.append((path, kwargs))
        if path == "/api/v1/content/read":
            return {"content": "page two", "next_offset": 1000}
        return "summary"

    monkeypatch.setattr(OpenVikingClient, "request", fake)
    response = authed.get("/api/openviking/content", params={"uri": "viking://user/default/note", "offset": 500, "limit": 500})
    assert response.status_code == 200
    assert response.json()["content"] == "page two"
    assert response.json()["hasMore"] is True
    assert calls[-1] == ("/api/v1/content/read", {"params": {"uri": "viking://user/default/note", "offset": 500, "limit": 500}})


def test_openviking_health_uses_health_and_observer_not_ready(authed, monkeypatch):
    calls = []

    async def fake(self, method, path, **kwargs):
        calls.append(path)
        return {"status": "ok"}

    monkeypatch.setattr(OpenVikingClient, "request", fake)
    response = authed.get("/api/openviking/health")
    assert response.status_code == 200
    assert calls == ["/health", "/api/v1/observer/system"]
    assert response.json()["reachable"] is True


def test_openviking_search_forces_actor_scope(authed, monkeypatch):
    calls = []

    async def fake(self, method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {"memories": [], "resources": [], "skills": [], "total": 0}

    monkeypatch.setattr(OpenVikingClient, "request", fake)
    response = authed.post("/api/openviking/search", json={"query": "home network", "mode": "fast", "target_uri": "viking://user/default/memories"}, headers=CSRF)
    assert response.status_code == 200
    assert calls[0][1] == "/api/v1/search/find"
    assert calls[0][2]["body"]["peer_scope"] == "actor"
    assert calls[0][2]["body"]["target_uri"] == "viking://user/default/memories"

    calls.clear()
    response = authed.post("/api/openviking/search", json={"query": "home network", "mode": "deep"}, headers=CSRF)
    assert response.status_code == 200
    assert calls[0][1] == "/api/v1/search/search"
    assert calls[0][2]["body"] == {"query": "home network", "mode": "context", "query_expansion": "off", "max_tokens": 4000, "peer_scope": "actor"}

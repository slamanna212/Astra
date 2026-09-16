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

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from fastapi.testclient import TestClient


def test_spa_fallback(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>astra</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("nope")

    c = make_client(static_dir=dist)
    assert c.get("/").text == "<html>astra</html>"
    assert c.get("/sessions/abc").text == "<html>astra</html>"
    js = c.get("/assets/app.js")
    assert js.text == "console.log(1)" and "immutable" in js.headers["cache-control"]
    assert "nope" not in c.get("/../secret.txt").text
    assert "nope" not in c.get("/%2e%2e/secret.txt").text
    # /api never falls back to the SPA.
    assert c.get("/api/unknown").status_code == 401


def test_no_static_dir_is_fine(client: TestClient) -> None:
    assert client.get("/").status_code == 404
    assert client.get("/api/health").status_code == 200

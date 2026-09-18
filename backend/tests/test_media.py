from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra.db import Schema
from astra.media import session_allows_media_path
from tests.conftest import login


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "image.png").write_bytes(b"\x89PNG\r\n\x1a\nimage")
    (root / "page.html").write_text("<html>not an image</html>")
    return root


def test_workspace_raster_image_is_served_inline(
    make_client: Callable[..., TestClient], workspace: Path
) -> None:
    client = make_client(workspace_dir=workspace)
    login(client)

    response = client.get("/api/media", params={"path": "image.png"})

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-disposition"] == "inline"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content == (workspace / "image.png").read_bytes()


def test_media_outside_workspace_is_denied_without_session_reference(
    make_client: Callable[..., TestClient], workspace: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"not really a png")
    client = make_client(workspace_dir=workspace)
    login(client)

    response = client.get("/api/media", params={"path": str(outside)})

    assert response.status_code == 403


def test_media_rejects_non_raster_files(
    make_client: Callable[..., TestClient], workspace: Path
) -> None:
    client = make_client(workspace_dir=workspace)
    login(client)

    response = client.get("/api/media", params={"path": "page.html"})

    assert response.status_code == 415


def test_session_media_allowlist_uses_only_non_user_messages(tmp_path: Path) -> None:
    target = tmp_path / "generated.png"
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT)")
    conn.executemany(
        "INSERT INTO messages VALUES (?, ?, ?)",
        [
            ("user-only", "user", f"MEDIA:{target}"),
            ("allowed", "assistant", f"Here it is\nMEDIA:{target}"),
        ],
    )
    schema = Schema(
        {"messages": frozenset({"session_id", "role", "content"}), "sessions": frozenset()}
    )

    assert session_allows_media_path(conn, schema, "allowed", target)
    assert not session_allows_media_path(conn, schema, "user-only", target)
    assert not session_allows_media_path(conn, schema, "missing", target)

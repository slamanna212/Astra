"""Profile/Bots behaviour: registry, per-profile worker isolation, native Bot Chats.

No live Hermes home, provider, MCP server or OpenViking instance is touched: each test builds
a throwaway home under ``tmp_path``. Bot Chat tests use Hermes' real ``SessionDB`` when its
source tree is present, and skip (never fake) when it is not.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import astra.profiles as profile_registry
from astra.auth import hash_password
from astra.config import Settings
from tests.conftest import CSRF, PASSWORD, login

HERMES_SRC = Path(os.environ.get("ASTRA_TEST_HERMES_SRC", "/opt/hermes"))
HERMES_AVAILABLE = (HERMES_SRC / "hermes_state.py").is_file()
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def make_settings(tmp_path: Path, **overrides) -> Settings:
    home = tmp_path / "hermes"
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        "model:\n  default: base-model\n  provider: openrouter\n", encoding="utf-8"
    )
    (home / "SOUL.md").write_text("default soul", encoding="utf-8")
    values = {
        "HERMES_HOME": str(home),
        "ASTRA_PASSWORD_HASH": hash_password(PASSWORD, n=2**14),
        "ASTRA_SESSION_SECRET": "test-secret-" + "y" * 40,
        "ASTRA_COOKIE_SECURE": "false",
        "ASTRA_STATIC_DIR": str(tmp_path / "static"),
        "ASTRA_WORKSPACE_DIR": str(tmp_path / "workspace"),
    }
    settings = Settings.from_env(values)
    return replace(settings, **overrides) if overrides else settings


def add_profile(settings: Settings, name: str, *, soul: str, model: str = "writer-model") -> Path:
    home = settings.hermes_home / "profiles" / name
    home.mkdir(parents=True)
    (home / "config.yaml").write_text(
        f"model:\n  default: {model}\n  provider: fake\n", encoding="utf-8"
    )
    (home / "profile.yaml").write_text(f"description: {name} bot\n", encoding="utf-8")
    (home / "SOUL.md").write_text(soul, encoding="utf-8")
    return home


@pytest.fixture
def gateway(tmp_path):
    from astra.app import create_app

    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))
    client.__enter__()
    try:
        yield client, settings
    finally:
        client.__exit__(None, None, None)


def test_roster_path_guards_and_legacy_surface(gateway, monkeypatch):
    client, settings = gateway
    add_profile(settings, "writer", soul="writer soul")
    add_profile(settings, "researcher", soul="researcher soul")
    outside = settings.hermes_home / "outside"
    outside.mkdir()
    (outside / "config.yaml").write_text("model: {default: nope}\n", encoding="utf-8")
    (settings.hermes_home / "profiles" / "escape").symlink_to(outside, target_is_directory=True)
    (settings.hermes_home / "profiles" / "bare").mkdir()  # no identity file: not a profile
    (settings.hermes_home / "profiles" / "apikey").mkdir()
    (settings.hermes_home / "profiles" / "apikey" / "config.yaml").write_text(
        "model:\n  default: m\n  provider: p\n  api_key: sk-should-never-be-returned\n",
        encoding="utf-8",
    )

    assert client.get("/api/bots").status_code == 401
    login(client)

    response = client.get("/api/bots")
    assert response.status_code == 200, response.text
    names = [row["name"] for row in response.json()["profiles"]]
    assert names == ["default", "apikey", "researcher", "writer"]
    assert "sk-should-never-be-returned" not in response.text
    assert "api_key" not in response.text
    # Readiness is reported, key material is not.
    assert response.json()["profiles"][0]["credentials_ready"] is True
    assert [row["title"] for row in response.json()["profiles"][1:]] == ["apikey", "researcher", "writer"]

    assert client.get("/api/bots/escape").status_code == 404
    assert client.get("/api/bots/bare").status_code == 404
    assert client.get("/api/profiles/missing/sessions").status_code == 404
    assert client.get("/api/bots/..%2F..%2Fetc").status_code == 404
    # A URL-encoded traversal never resolves outside the profiles root either.
    assert client.get("/api/profiles/escape/sessions").status_code == 404

    detail = client.get("/api/bots/writer")
    assert detail.status_code == 200, detail.text
    assert detail.json()["soul"] == "writer soul"
    assert detail.json()["model"] == "writer-model"

    # The pre-profiles surface still answers for the default profile.
    legacy = client.get("/api/memory/files")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["files"]["soul"] == "default soul"
    scoped = client.get("/api/profiles/writer/memory/files")
    assert scoped.status_code == 200, scoped.text
    assert scoped.json()["files"]["soul"] == "writer soul"


def test_two_profiles_are_served_from_one_process_with_separate_homes(gateway):
    """One process, one context per bot: each request reads its own home, nothing shared."""
    client, settings = gateway
    alpha = add_profile(settings, "alpha", soul="alpha soul", model="alpha-model")
    beta = add_profile(settings, "beta", soul="beta soul", model="beta-model")

    login(client)
    first = client.get("/api/profiles/alpha/memory/files")
    second = client.get("/api/profiles/beta/memory/files")
    assert [first.status_code, second.status_code] == [200, 200], [first.text, second.text]
    assert [first.json()["files"]["soul"], second.json()["files"]["soul"]] == ["alpha soul", "beta soul"]

    contexts = client.app.state.contexts.loaded()
    assert set(contexts) == {"alpha", "beta"}
    assert contexts["alpha"].settings.hermes_home == alpha
    assert contexts["beta"].settings.hermes_home == beta
    # Each bot answers with its own model, and the default profile is untouched.
    assert client.get("/api/bots/alpha").json()["model"] == "alpha-model"
    assert client.get("/api/bots/beta").json()["model"] == "beta-model"
    assert client.app.state.ctx.settings.hermes_home == settings.hermes_home

    # An unknown bot never resolves to a real home.
    assert client.get("/api/profiles/nope/memory/files").status_code == 404


def _fake_admin(created: list[dict], deleted: list[str]):
    """A stand-in for the native Hermes CLI boundary (that path needs the real source tree)."""

    def run(op: dict) -> dict:
        name = op["name"]
        if op["op"] == "create":
            home = Path(os.environ["HERMES_HOME"]) / "profiles" / name
            source = op.get("clone_from")
            home.mkdir(parents=True)
            if source:
                (home / "config.yaml").write_text("model:\n  default: cloned\n  provider: fake\n")
            else:
                (home / "config.yaml").write_text("model:\n  default: fresh\n  provider: fake\n")
            (home / "profile.yaml").write_text("description: ''\n")
            (home / "SOUL.md").write_text("")
            created.append(op)
            return {"ok": True, "name": name, "path": str(home)}
        if op["op"] == "describe":
            path = Path(os.environ["HERMES_HOME"]) / "profiles" / name / "profile.yaml"
            path.write_text(f"description: {op['description']}\n")
            return {"ok": True}
        if op["op"] == "pin_model":
            path = Path(os.environ["HERMES_HOME"]) / "profiles" / name / "config.yaml"
            path.write_text(f"model:\n  default: {op['model']}\n  provider: {op['provider']}\n")
            return {"ok": True}
        if op["op"] == "delete":
            import shutil

            shutil.rmtree(Path(os.environ["HERMES_HOME"]) / "profiles" / name)
            deleted.append(name)
            return {"ok": True}
        raise AssertionError(f"unexpected admin op {op}")

    return run


def test_profile_crud_ui_meta_and_avatar(gateway, monkeypatch):
    client, settings = gateway
    created: list[dict] = []
    deleted: list[str] = []
    monkeypatch.setenv("HERMES_HOME", str(settings.hermes_home))
    monkeypatch.setattr(profile_registry, "_admin_runner", _fake_admin(created, deleted))
    login(client)

    assert client.post("/api/bots", json={"name": "Bad Name"}, headers=CSRF).status_code == 422
    assert client.post("/api/bots", json={"name": "default"}, headers=CSRF).status_code == 422
    response = client.post(
        "/api/bots",
        json={"name": "editor", "title": "Copy Editor", "description": "Edits copy", "soul": "Be precise"},
        headers=CSRF,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Copy Editor"
    assert body["description"] == "Edits copy"
    assert body["soul"] == "Be precise"
    assert body["is_default"] is False
    assert body["hidden"] is False

    # Duplicate names are rejected before the native boundary is invoked again.
    assert client.post("/api/bots", json={"name": "editor"}, headers=CSRF).status_code == 409
    assert len(created) == 1

    home = settings.hermes_home / "profiles" / "editor"
    import yaml

    meta = yaml.safe_load((home / "profile.yaml").read_text())
    assert meta["ui_meta"]["hermes-bots"]["title"] == "Copy Editor"
    assert meta["_ui_meta_revisions"]["title"] == 1

    patched = client.patch(
        "/api/bots/editor",
        json={"hidden": True, "section": "Editorial", "title": "Copy", "model": "m2", "provider": "p2"},
        headers=CSRF,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["hidden"] is True
    assert patched.json()["section"] == "Editorial"
    assert patched.json()["model"] == "m2"
    meta = yaml.safe_load((home / "profile.yaml").read_text())
    assert meta["ui_meta"]["hermes-bots"] == {"title": "Copy", "hidden": True, "section": "Editorial"}
    assert meta["_ui_meta_revisions"]["title"] == 2

    upload = client.post(
        "/api/bots/editor/avatar", files={"file": ("a.png", PNG, "image/png")}, headers=CSRF
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["avatar_url"] == "/api/bots/editor/avatar"
    assert (home / "assets" / "avatar.png").read_bytes() == PNG
    image = client.get("/api/bots/editor/avatar")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"

    bad = client.post(
        "/api/bots/editor/avatar",
        files={"file": ("a.svg", b"<svg onload=alert(1)>", "image/svg+xml")},
        headers=CSRF,
    )
    assert bad.status_code == 415
    big = client.post(
        "/api/bots/editor/avatar",
        files={"file": ("big.png", PNG + b"\x00" * (2_000_001)), "content-type": "image/png"},
        headers=CSRF,
    )
    assert big.status_code == 413

    cleared = client.delete("/api/bots/editor/avatar", headers=CSRF)
    assert cleared.status_code == 200
    assert cleared.json()["avatar_url"] is None
    assert client.get("/api/bots/editor/avatar").status_code == 404

    assert client.delete("/api/bots/default", headers=CSRF).status_code == 409
    assert client.delete("/api/bots/editor", headers=CSRF).status_code == 204
    assert deleted == ["editor"]
    assert client.get("/api/bots/editor").status_code == 404


def test_canonical_bot_chat_uses_native_title_hidden_pin(tmp_path):
    if not HERMES_AVAILABLE:
        pytest.skip("Hermes source tree not available")
    from astra.app import create_app

    settings = make_settings(tmp_path, hermes_src=HERMES_SRC)
    add_profile(settings, "writer", soul="writer soul")
    client = TestClient(create_app(settings))
    with client:
        login(client)
        first = client.post("/api/bots/writer/bot-chat", headers=CSRF)
        assert first.status_code == 200, first.text
        session_id = first.json()["session_id"]
        assert first.json()["created"] is True

        again = client.post("/api/bots/writer/bot-chat", headers=CSRF)
        assert again.json() == {"session_id": session_id, "created": False}

        db_path = settings.hermes_home / "profiles" / "writer" / "state.db"
        with sqlite3.connect(db_path) as db:
            row = db.execute(
                "SELECT title, hidden, pinned, archived FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
        assert row == ("Bot Chat", 1, 1, 0)

        # The roster previews and click target are the same canonical row.
        rows = {row["name"]: row for row in client.get("/api/bots").json()["profiles"]}
        assert rows["writer"]["bot_session_id"] == session_id

        assert client.post("/api/bots/writer/read", headers=CSRF).status_code == 204
        with sqlite3.connect(db_path) as db:
            assert db.execute(
                "SELECT last_read_at FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()[0] is not None

        archived = client.patch(
            f"/api/profiles/writer/sessions/{session_id}", json={"archived": True}, headers=CSRF
        )
        assert archived.status_code == 200, archived.text

        # Archiving retires the canonical chat; the next open mints a fresh one and the
        # retired row keeps its history but loses the name (native UNIQUE(title) rule).
        fresh = client.post("/api/bots/writer/bot-chat", headers=CSRF)
        assert fresh.status_code == 200, fresh.text
        new_id = fresh.json()["session_id"]
        assert new_id != session_id
        with sqlite3.connect(db_path) as db:
            old = db.execute("SELECT title, archived FROM sessions WHERE id = ?", (session_id,)).fetchone()
            new = db.execute("SELECT title, hidden, pinned FROM sessions WHERE id = ?", (new_id,)).fetchone()
        assert old == (None, 1)
        assert new == ("Bot Chat", 1, 1)

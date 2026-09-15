"""Astra must not create any store in HERMES_HOME (BUILD-SPEC §3.1, §3.7)."""

from __future__ import annotations

import hashlib
import os
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from astra.app import create_app
from astra.config import Settings
from astra.db import StateDB

from .conftest import CSRF, PASSWORD


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            p = Path(dirpath) / name
            st = p.lstat()
            out[str(p.relative_to(root))] = (st.st_size, st.st_mtime_ns)
    return out


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def test_app_writes_nothing_into_hermes_home(base_settings: Settings) -> None:
    home = base_settings.hermes_home
    before = _snapshot(home)
    digest = _sha(home / "state.db")

    with TestClient(create_app(base_settings)) as c:
        assert c.get("/api/health").status_code == 200
        assert c.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF).status_code == 204
        cursor = None
        while True:
            params = {"limit": 20, "include_archived": True, "include_hidden": True}
            if cursor:
                params["cursor"] = cursor
            body = c.get("/api/sessions", params=params).json()
            for item in body["items"][:2]:
                assert c.get(f"/api/sessions/{item['id']}").status_code == 200
            cursor = body["next_cursor"]
            if not cursor:
                break
        assert c.get("/api/status").status_code == 200
        assert c.post("/api/auth/logout", headers=CSRF).status_code == 204

    assert _snapshot(home) == before, "Astra created or modified files in HERMES_HOME"
    assert _sha(home / "state.db") == digest
    # Phase 0 needs no UI-owned state, so ASTRA_DATA_DIR is not even created.
    assert not base_settings.data_dir.exists()


def test_wal_sidecar_behaviour_documented(tmp_path: Path) -> None:
    """mode=ro never creates or modifies the DB file. For a WAL-mode DB whose -wal/-shm are
    absent, SQLite creates those coordination files (Hermes keeps them present while running);
    they are not a store. A rollback-journal DB gets no sidecars at all."""
    wal_db = tmp_path / "wal.db"
    w = sqlite3.connect(wal_db)
    w.execute("PRAGMA journal_mode=wal")
    w.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL)")
    w.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY)")
    w.execute("INSERT INTO sessions VALUES ('a', 1.0)")
    w.commit()
    w.close()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["wal.db"]
    digest = _sha(wal_db)

    db = StateDB(wal_db)
    assert db.ping()
    db.close()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["wal.db", "wal.db-shm", "wal.db-wal"]
    assert _sha(wal_db) == digest
    assert (tmp_path / "wal.db-wal").stat().st_size == 0

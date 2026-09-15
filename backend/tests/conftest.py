from __future__ import annotations

import shutil
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra.app import create_app
from astra.auth import hash_password
from astra.config import REPO_DIR, Settings

FIXTURE_DB = REPO_DIR / "exampledata" / "hermes-ui-handoff" / "fixture" / "state.db"
PASSWORD = "correct horse battery staple"
SECRET = "test-secret-" + "x" * 40
CSRF = {"X-Requested-With": "astra"}


@pytest.fixture(scope="session")
def password_hash() -> str:
    # Cheaper scrypt cost for tests; format is identical.
    return hash_password(PASSWORD, n=2**14)


@pytest.fixture(scope="session")
def hermes_home(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if not FIXTURE_DB.is_file():
        pytest.skip(f"fixture DB missing: {FIXTURE_DB}")
    home = tmp_path_factory.mktemp("hermes-home")
    shutil.copy2(FIXTURE_DB, home / "state.db")
    return home


@pytest.fixture(scope="session")
def fixture_db_path(hermes_home: Path) -> Path:
    return hermes_home / "state.db"


@pytest.fixture(scope="session")
def base_settings(hermes_home: Path, password_hash: str, tmp_path_factory: pytest.TempPathFactory) -> Settings:
    return Settings.from_env(
        {
            "HERMES_HOME": str(hermes_home),
            "ASTRA_PASSWORD_HASH": password_hash,
            "ASTRA_SESSION_SECRET": SECRET,
            "ASTRA_COOKIE_SECURE": "false",
            # Point static at an empty dir so tests never depend on a frontend build.
            "ASTRA_STATIC_DIR": str(tmp_path_factory.mktemp("no-static")),
        }
    )


@pytest.fixture
def make_client(base_settings: Settings) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def _make(**overrides: object) -> TestClient:
        settings = replace(base_settings, **overrides) if overrides else base_settings
        client = TestClient(create_app(settings))
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


def login(client: TestClient, password: str = PASSWORD) -> None:
    resp = client.post("/api/auth/login", json={"password": password}, headers=CSRF)
    assert resp.status_code == 204, resp.text


@pytest.fixture
def authed(client: TestClient) -> TestClient:
    login(client)
    return client

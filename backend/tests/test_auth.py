from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra.auth import (
    COOKIE_NAME,
    LoginRateLimiter,
    hash_password,
    issue_token,
    parse_password_hash,
    verify_password,
    verify_token,
)
from astra.config import ConfigError, Settings

from .conftest import CSRF, PASSWORD, SECRET, login

# -- password hashing --------------------------------------------------------


def test_hash_roundtrip() -> None:
    encoded = hash_password("hunter22", n=2**14)
    assert encoded.startswith("scrypt$16384$8$1$")
    assert verify_password("hunter22", encoded)
    assert not verify_password("hunter23", encoded)
    assert hash_password("hunter22", n=2**14) != encoded  # salted


@pytest.mark.parametrize("bad", ["", "scrypt$1$2$3", "bcrypt$16384$8$1$AAAA$BBBB", "scrypt$abc$8$1$x$y"])
def test_malformed_hash_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_password_hash(bad)
    assert not verify_password("anything", bad)


# -- tokens ------------------------------------------------------------------


def test_token_roundtrip_and_tamper() -> None:
    secret = SECRET.encode()
    value, token = issue_token(secret)
    assert verify_token(secret, value) == token
    assert token.expires_at - token.issued_at == 30 * 24 * 3600
    payload, sig = value.split(".")
    assert verify_token(secret, payload + "." + sig[:-2] + "AA") is None
    assert verify_token(secret, payload[:-2] + "xx." + sig) is None
    assert verify_token(b"other-secret" * 4, value) is None
    assert verify_token(secret, "garbage") is None
    assert verify_token(secret, None) is None


def test_token_expiry() -> None:
    secret = SECRET.encode()
    value, _ = issue_token(secret, now=time.time() - 31 * 24 * 3600)
    assert verify_token(secret, value) is None
    future, _ = issue_token(secret, now=time.time() + 3600)
    assert verify_token(secret, future) is None


def test_rate_limiter_window() -> None:
    rl = LoginRateLimiter(max_failures=5, window_seconds=300)
    for i in range(5):
        assert rl.retry_after("ip", now=1000 + i) is None
        rl.record_failure("ip", now=1000 + i)
    assert rl.retry_after("ip", now=1010) is not None
    assert rl.retry_after("other", now=1010) is None
    assert rl.retry_after("ip", now=1000 + 301 + 4) is None


# -- HTTP --------------------------------------------------------------------


def test_health_is_public_and_minimal(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"status", "version", "state_db"}
    assert body["status"] == "ok"
    assert body["state_db"] == {"ok": True}


def test_login_success_sets_cookie(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    resp = client.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF)
    assert resp.status_code == 204
    set_cookie = resp.headers["set-cookie"]
    assert set_cookie.startswith(f"{COOKIE_NAME}=")
    lowered = set_cookie.lower()
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/" in lowered
    assert "max-age=2592000" in lowered
    assert "secure" not in lowered  # test settings disable Secure
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json() == {"authenticated": True}
    assert me.headers["cache-control"] == "no-store"


def test_cookie_secure_flag(make_client: Callable[..., TestClient]) -> None:
    c = make_client(cookie_secure=True)
    resp = c.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF)
    assert resp.status_code == 204
    assert "secure" in resp.headers["set-cookie"].lower()


def test_login_failure(client: TestClient) -> None:
    resp = client.post("/api/auth/login", json={"password": "wrong"}, headers=CSRF)
    assert resp.status_code == 401
    assert "set-cookie" not in resp.headers
    assert client.get("/api/auth/me").status_code == 401


def test_login_validation(client: TestClient) -> None:
    assert client.post("/api/auth/login", json={}, headers=CSRF).status_code == 422
    assert client.post("/api/auth/login", json={"password": ""}, headers=CSRF).status_code == 422


def test_login_rate_limit(client: TestClient) -> None:
    for _ in range(5):
        assert client.post("/api/auth/login", json={"password": "nope"}, headers=CSRF).status_code == 401
    resp = client.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF)
    assert resp.status_code == 429
    assert int(resp.headers["retry-after"]) > 0


def test_success_resets_failures(client: TestClient) -> None:
    for _ in range(4):
        client.post("/api/auth/login", json={"password": "nope"}, headers=CSRF)
    login(client)
    for _ in range(4):
        assert client.post("/api/auth/login", json={"password": "nope"}, headers=CSRF).status_code == 401


def test_sessions_require_cookie(client: TestClient) -> None:
    assert client.get("/api/sessions").status_code == 401
    assert client.get("/api/sessions/anything").status_code == 401
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/does-not-exist").status_code == 401


def test_unknown_api_path_404_when_authed(authed: TestClient) -> None:
    assert authed.get("/api/does-not-exist").status_code == 404


def test_csrf_header_required_on_post(authed: TestClient) -> None:
    assert authed.post("/api/auth/logout").status_code == 403
    assert authed.post("/api/auth/logout", headers={"X-Requested-With": "XMLHttpRequest"}).status_code == 403
    assert authed.post("/api/auth/login", json={"password": PASSWORD}).status_code == 403
    for method in ("PUT", "PATCH", "DELETE"):
        assert authed.request(method, "/api/sessions/x").status_code == 403
    # Still logged in: the rejected logout did nothing.
    assert authed.get("/api/auth/me").status_code == 200


def test_tampered_cookie_rejected(authed: TestClient) -> None:
    value = authed.cookies[COOKIE_NAME]
    payload, sig = value.split(".")
    authed.cookies.clear()
    authed.cookies.set(COOKIE_NAME, payload + "." + ("A" if sig[0] != "A" else "B") + sig[1:])
    assert authed.get("/api/auth/me").status_code == 401


def test_forged_cookie_other_secret_rejected(client: TestClient) -> None:
    value, _ = issue_token(b"attacker-secret-" * 4)
    client.cookies.set(COOKIE_NAME, value)
    assert client.get("/api/sessions").status_code == 401


def test_expired_cookie_rejected(client: TestClient) -> None:
    value, _ = issue_token(SECRET.encode(), now=time.time() - 31 * 24 * 3600)
    client.cookies.set(COOKIE_NAME, value)
    assert client.get("/api/auth/me").status_code == 401
    fresh, _ = issue_token(SECRET.encode())
    client.cookies.set(COOKIE_NAME, fresh)
    assert client.get("/api/auth/me").status_code == 200


def test_logout_clears_and_revokes(authed: TestClient) -> None:
    old = authed.cookies[COOKIE_NAME]
    resp = authed.post("/api/auth/logout", headers=CSRF)
    assert resp.status_code == 204
    assert f'{COOKIE_NAME}=""' in resp.headers["set-cookie"] or "max-age=0" in resp.headers["set-cookie"].lower()
    assert authed.get("/api/auth/me").status_code == 401
    authed.cookies.set(COOKIE_NAME, old)
    assert authed.get("/api/auth/me").status_code == 401


def test_logout_without_session_is_harmless(client: TestClient) -> None:
    assert client.post("/api/auth/logout", headers=CSRF).status_code == 204


def test_status_authenticated(authed: TestClient) -> None:
    body = authed.get("/api/status").json()
    assert body["state_db_ok"] is True
    assert body["session_count"] == 86
    assert body["hermes_home_exists"] is True
    assert body["journal_mode"] in {"delete", "wal"}


# -- config ------------------------------------------------------------------


def _env(home: Path, password_hash: str, **extra: str) -> dict[str, str]:
    env = {"HERMES_HOME": str(home), "ASTRA_PASSWORD_HASH": password_hash, "ASTRA_SESSION_SECRET": SECRET}
    env.update(extra)
    return env


def test_config_requires_hermes_home(password_hash: str, tmp_path: Path) -> None:
    env = _env(tmp_path, password_hash)
    del env["HERMES_HOME"]
    with pytest.raises(ConfigError, match="HERMES_HOME is not set"):
        Settings.from_env(env)
    with pytest.raises(ConfigError, match="does not exist"):
        Settings.from_env(_env(tmp_path / "missing", password_hash))


@pytest.mark.parametrize("missing", ["ASTRA_PASSWORD_HASH", "ASTRA_SESSION_SECRET"])
def test_config_requires_secrets(password_hash: str, tmp_path: Path, missing: str) -> None:
    env = _env(tmp_path, password_hash)
    env[missing] = ""
    with pytest.raises(ConfigError, match=missing):
        Settings.from_env(env)


def test_config_rejects_weak_values(password_hash: str, tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="at least"):
        Settings.from_env(_env(tmp_path, password_hash, ASTRA_SESSION_SECRET="short"))
    with pytest.raises(ConfigError, match="malformed"):
        Settings.from_env(_env(tmp_path, "plaintext"))


def test_config_defaults(password_hash: str, tmp_path: Path) -> None:
    s = Settings.from_env(_env(tmp_path, password_hash))
    assert s.cookie_secure is True
    assert s.data_dir == tmp_path.resolve() / "astra-ui"
    assert s.paths.state_db == tmp_path.resolve() / "state.db"
    assert s.paths.cron_jobs == tmp_path.resolve() / "cron" / "jobs.json"
    assert SECRET not in repr(s) and password_hash not in repr(s)

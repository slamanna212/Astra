"""Settings resolved from the environment.

Every Hermes path is derived from ``HERMES_HOME`` — the same volume is mounted at different
absolute paths in different containers (BUILD-SPEC §1.3), so no lane path is ever hardcoded.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

from astra.auth import parse_password_hash

# backend/src/astra/config.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent

MIN_SECRET_LENGTH = 32
_PATH_VARS = {"HERMES_HOME", "ASTRA_HERMES_SRC", "ASTRA_DATA_DIR", "ASTRA_STATIC_DIR", "ASTRA_WORKSPACE_DIR"}
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}
DEFAULT_WORKSPACE_DIR = "/workspace"
DEFAULT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _parse_bool(name: str, raw: str | None, default: bool) -> bool:
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ConfigError(f"{name} must be a boolean (true/false), got {raw!r}")


@dataclass(frozen=True, slots=True)
class HermesPaths:
    """Paths inside HERMES_HOME. All derived, never hardcoded."""

    home: Path

    @property
    def state_db(self) -> Path:
        return self.home / "state.db"

    @property
    def config_yaml(self) -> Path:
        return self.home / "config.yaml"

    @property
    def cron_dir(self) -> Path:
        return self.home / "cron"

    @property
    def cron_jobs(self) -> Path:
        return self.cron_dir / "jobs.json"

    @property
    def cron_output_dir(self) -> Path:
        return self.cron_dir / "output"

    @property
    def cron_executions_db(self) -> Path:
        return self.cron_dir / "executions.db"

    @property
    def skills_dir(self) -> Path:
        return self.home / "skills"

    @property
    def memories_dir(self) -> Path:
        return self.home / "memories"

    @property
    def soul_md(self) -> Path:
        return self.home / "SOUL.md"

    @property
    def logs_dir(self) -> Path:
        return self.home / "logs"

    @property
    def scripts_dir(self) -> Path:
        return self.home / "scripts"


DEFAULT_CRON_POLL_INTERVAL_S = 1.0


@dataclass(frozen=True, slots=True)
class Settings:
    hermes_home: Path
    hermes_src: Path | None
    data_dir: Path
    static_dir: Path
    password_hash: str
    session_secret: bytes
    cookie_secure: bool
    workspace_dir: Path
    upload_max_bytes: int
    cron_poll_interval_s: float = DEFAULT_CRON_POLL_INTERVAL_S
    openviking_endpoint: str | None = None
    openviking_api_key: str | None = None
    openviking_account: str = "default"
    openviking_user: str = "default"

    @property
    def paths(self) -> HermesPaths:
        return HermesPaths(self.hermes_home)

    def __repr__(self) -> str:  # never leak secrets through repr()/logging
        return (
            f"Settings(hermes_home={str(self.hermes_home)!r}, hermes_src={self.hermes_src!r}, "
            f"data_dir={str(self.data_dir)!r}, static_dir={str(self.static_dir)!r}, "
            f"workspace_dir={str(self.workspace_dir)!r}, upload_max_bytes={self.upload_max_bytes}, "
            f"cookie_secure={self.cookie_secure}, password_hash=<redacted>, session_secret=<redacted>)"
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        raw_home = (env.get("HERMES_HOME") or "").strip()
        if not raw_home:
            raise ConfigError(
                "HERMES_HOME is not set. Point it at the Hermes data directory "
                "(the directory containing state.db)."
            )
        hermes_home = Path(raw_home).expanduser().resolve()
        if not hermes_home.is_dir():
            raise ConfigError(f"HERMES_HOME={raw_home!r} does not exist or is not a directory.")

        raw_src = (env.get("ASTRA_HERMES_SRC") or "").strip()
        hermes_src: Path | None = None
        if raw_src:
            hermes_src = Path(raw_src).expanduser().resolve()
            if not hermes_src.is_dir():
                raise ConfigError(f"ASTRA_HERMES_SRC={raw_src!r} is not a directory.")

        raw_data = (env.get("ASTRA_DATA_DIR") or "").strip()
        data_dir = (
            Path(raw_data).expanduser().resolve() if raw_data else hermes_home / "astra-ui"
        )

        raw_static = (env.get("ASTRA_STATIC_DIR") or "").strip()
        static_dir = (
            Path(raw_static).expanduser().resolve() if raw_static else REPO_DIR / "frontend" / "dist"
        )

        password_hash = (env.get("ASTRA_PASSWORD_HASH") or "").strip()
        if not password_hash:
            raise ConfigError(
                "ASTRA_PASSWORD_HASH is not set. Generate one with "
                "`uv run python -m astra.hashpw` and set it in the environment."
            )
        try:
            parse_password_hash(password_hash)
        except ValueError as exc:
            raise ConfigError(f"ASTRA_PASSWORD_HASH is malformed: {exc}") from None

        session_secret = (env.get("ASTRA_SESSION_SECRET") or "").strip()
        if not session_secret:
            raise ConfigError(
                "ASTRA_SESSION_SECRET is not set. Generate one with "
                "`python -c 'import secrets; print(secrets.token_urlsafe(48))'`."
            )
        if len(session_secret) < MIN_SECRET_LENGTH:
            raise ConfigError(
                f"ASTRA_SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters."
            )

        cookie_secure = _parse_bool("ASTRA_COOKIE_SECURE", env.get("ASTRA_COOKIE_SECURE"), True)

        # Files browses ONLY this root (never HERMES_HOME) — see BUILD-SPEC §5.6 and the Phase 1
        # Files/Logs decision doc. Not validated for existence at startup (unlike HERMES_HOME):
        # in production it is a mount that may not be present yet at process start, and most
        # tests/dev flows never touch Files at all. Existence is checked lazily per-request.
        raw_workspace = (env.get("ASTRA_WORKSPACE_DIR") or "").strip()
        workspace_dir = (
            Path(raw_workspace).expanduser().resolve() if raw_workspace else Path(DEFAULT_WORKSPACE_DIR)
        )

        raw_upload_max = (env.get("ASTRA_UPLOAD_MAX_BYTES") or "").strip()
        if raw_upload_max:
            try:
                upload_max_bytes = int(raw_upload_max)
            except ValueError:
                raise ConfigError(f"ASTRA_UPLOAD_MAX_BYTES must be an integer, got {raw_upload_max!r}") from None
            if upload_max_bytes <= 0:
                raise ConfigError("ASTRA_UPLOAD_MAX_BYTES must be positive")
        else:
            upload_max_bytes = DEFAULT_UPLOAD_MAX_BYTES

        raw_poll = (env.get("ASTRA_CRON_POLL_INTERVAL_S") or "").strip()
        if raw_poll:
            try:
                cron_poll_interval_s = float(raw_poll)
            except ValueError:
                raise ConfigError(
                    f"ASTRA_CRON_POLL_INTERVAL_S must be a number, got {raw_poll!r}"
                ) from None
            if cron_poll_interval_s <= 0:
                raise ConfigError("ASTRA_CRON_POLL_INTERVAL_S must be positive")
        else:
            cron_poll_interval_s = DEFAULT_CRON_POLL_INTERVAL_S

        # Hermes normally keeps these in its own .env on the shared volume.  They
        # are deliberately read here, rather than ever being accepted from HTTP.
        hermes_env = dotenv_values(hermes_home / ".env") if (hermes_home / ".env").is_file() else {}
        def ov(name: str, default: str | None = None) -> str | None:
            return (env.get(f"ASTRA_{name}") or env.get(name) or hermes_env.get(name) or default)

        return cls(
            hermes_home=hermes_home,
            hermes_src=hermes_src,
            data_dir=data_dir,
            static_dir=static_dir,
            password_hash=password_hash,
            session_secret=session_secret.encode("utf-8"),
            cookie_secure=cookie_secure,
            workspace_dir=workspace_dir,
            upload_max_bytes=upload_max_bytes,
            cron_poll_interval_s=cron_poll_interval_s,
            openviking_endpoint=(ov("OPENVIKING_ENDPOINT") or "").rstrip("/") or None,
            openviking_api_key=ov("OPENVIKING_API_KEY"),
            openviking_account=ov("OPENVIKING_ACCOUNT", "default") or "default",
            openviking_user=ov("OPENVIKING_USER", "default") or "default",
        )


def load_settings(dotenv_path: Path | None = BACKEND_DIR / ".env") -> Settings:
    """Load settings from the process environment, with ``backend/.env`` as a fallback.

    Real environment variables always win over values in the .env file.
    """
    env: dict[str, str] = {}
    if dotenv_path is not None and dotenv_path.is_file():
        for key, value in dotenv_values(dotenv_path).items():
            if value is None:
                continue
            if key in _PATH_VARS and value.strip() and not Path(value.strip()).expanduser().is_absolute():
                # Relative paths in .env are relative to the .env file, not the CWD.
                value = str(dotenv_path.parent / value.strip())
            env[key] = value
    env.update(os.environ)
    return Settings.from_env(env)


def apply_hermes_src(settings: Settings) -> None:
    """Prepend ASTRA_HERMES_SRC to sys.path so Hermes modules are importable in dev.

    Also mirrors our resolved ``hermes_home`` into the real process environment.
    Hermes' own ``hermes_constants.get_hermes_home()`` reads ``os.environ["HERMES_HOME"]``
    directly, and several Hermes modules (``cron.jobs``, ``tools.skills_tool``) memoize
    paths derived from it at *import time*. ``HERMES_HOME`` may have reached us only via
    ``backend/.env`` (see ``load_settings``), never landing in the real ``os.environ`` —
    so without this, a lazy `import cron.jobs` after this call would still resolve the
    wrong (platform-default) home. Call this before any lazy import of a Hermes module
    that reads ``HERMES_HOME`` (see ``astra.hermes_bridge``).
    """
    if settings.hermes_src is not None:
        src = str(settings.hermes_src)
        if src not in sys.path:
            sys.path.insert(0, src)
    os.environ["HERMES_HOME"] = str(settings.hermes_home)

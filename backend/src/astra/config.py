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
_PATH_VARS = {"HERMES_HOME", "ASTRA_HERMES_SRC", "ASTRA_DATA_DIR", "ASTRA_STATIC_DIR"}
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


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


@dataclass(frozen=True, slots=True)
class Settings:
    hermes_home: Path
    hermes_src: Path | None
    data_dir: Path
    static_dir: Path
    password_hash: str
    session_secret: bytes
    cookie_secure: bool

    @property
    def paths(self) -> HermesPaths:
        return HermesPaths(self.hermes_home)

    def __repr__(self) -> str:  # never leak secrets through repr()/logging
        return (
            f"Settings(hermes_home={str(self.hermes_home)!r}, hermes_src={self.hermes_src!r}, "
            f"data_dir={str(self.data_dir)!r}, static_dir={str(self.static_dir)!r}, "
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

        return cls(
            hermes_home=hermes_home,
            hermes_src=hermes_src,
            data_dir=data_dir,
            static_dir=static_dir,
            password_hash=password_hash,
            session_secret=session_secret.encode("utf-8"),
            cookie_secure=cookie_secure,
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
    """Prepend ASTRA_HERMES_SRC to sys.path so Hermes modules are importable in dev."""
    if settings.hermes_src is None:
        return
    src = str(settings.hermes_src)
    if src not in sys.path:
        sys.path.insert(0, src)

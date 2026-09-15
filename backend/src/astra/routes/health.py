from __future__ import annotations

import importlib.util
import sqlite3

import anyio.to_thread
from fastapi import APIRouter

from astra import __version__
from astra.db import StateDBUnavailable
from astra.deps import Ctx
from astra.models import Health, StateDBHealth, Status
from astra.sessions import count_sessions

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=Health)
async def health(ctx: Ctx) -> Health:
    """Unauthenticated liveness. Deliberately reveals nothing beyond ok/version."""
    ok = await anyio.to_thread.run_sync(ctx.db.ping)
    return Health(status="ok", version=__version__, state_db=StateDBHealth(ok=ok))


def _hermes_importable() -> bool:
    try:
        return importlib.util.find_spec("hermes_state") is not None
    except (ImportError, ValueError):
        return False


@router.get("/status", response_model=Status)
async def status(ctx: Ctx) -> Status:
    def _probe() -> tuple[bool, int | None, str | None]:
        try:
            with ctx.db.connection() as conn:
                count = count_sessions(conn)
                mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            return True, count, str(mode)
        except (sqlite3.Error, StateDBUnavailable):
            return False, None, None

    ok, count, mode = await anyio.to_thread.run_sync(_probe)
    return Status(
        version=__version__,
        hermes_home_exists=ctx.settings.hermes_home.is_dir(),
        state_db_ok=ok,
        session_count=count,
        journal_mode=mode,
        hermes_src_configured=ctx.settings.hermes_src is not None,
        hermes_importable=_hermes_importable(),
    )

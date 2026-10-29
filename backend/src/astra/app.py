"""Application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import anyio.to_thread
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from astra import __version__
from astra.config import Settings, apply_hermes_src
from astra.db import StateDB, StateDBUnavailable
from astra.deps import AppContext, ProfileContexts, close_context
from astra.middleware import ApiGuardMiddleware, ProfilePathMiddleware
from astra.routes import auth as auth_routes
from astra.routes import chat as chat_routes
from astra.routes import cron as cron_routes
from astra.routes import files as files_routes
from astra.routes import health as health_routes
from astra.routes import insights as insights_routes
from astra.routes import logs as logs_routes
from astra.routes import media as media_routes
from astra.routes import memory as memory_routes
from astra.routes import messages as message_routes
from astra.routes import openviking as openviking_routes
from astra.routes import profiles_api as profiles_routes
from astra.routes import search as search_routes
from astra.routes import sessions as session_routes
from astra.routes import skills as skills_routes
from astra.routes import terminal as terminal_routes

log = logging.getLogger(__name__)


# Routers that read or write profile-owned state. Each is mounted twice: once at ``/api`` for
# the default profile and once at ``/api/profiles/{profile}`` for a named one.
PROFILE_ROUTERS = (
    chat_routes,
    session_routes,
    message_routes,
    search_routes,
    insights_routes,
    files_routes,
    media_routes,
    logs_routes,
    memory_routes,
    openviking_routes,
    cron_routes,
    skills_routes,
    terminal_routes,
)


def create_app(settings: Settings) -> FastAPI:
    """Build the application.

    One process serves every profile: ``/api/...`` is the default profile, and
    ``/api/profiles/<name>/...`` serves that profile's own home through the same routes.
    """
    apply_hermes_src(settings)
    ctx = AppContext(settings=settings, db=StateDB(settings.paths.state_db))
    contexts = ProfileContexts(ctx)
    ctx.profile_contexts = contexts

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            await anyio.to_thread.run_sync(ctx.db.introspect)
        except StateDBUnavailable as exc:
            # Not fatal: health reports it and queries retry lazily.
            log.error("state.db unavailable at startup: %s", exc)
        log.info(
            "astra started",
            extra={"version": __version__, "static": settings.static_dir.is_dir()},
        )
        try:
            yield
        finally:
            await contexts.close()
            await close_context(ctx)

    app = FastAPI(
        title="Astra",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.ctx = ctx
    app.state.contexts = contexts

    @app.exception_handler(StateDBUnavailable)
    async def _state_db_unavailable(_: Request, __: StateDBUnavailable) -> JSONResponse:
        return JSONResponse({"detail": "state.db unavailable"}, status_code=503)

    app.include_router(health_routes.router)
    app.include_router(auth_routes.router)
    app.include_router(profiles_routes.router)
    for module in PROFILE_ROUTERS:
        app.include_router(module.router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def _api_not_found(rest: str) -> JSONResponse:
        # Keep unknown /api paths from falling through to the SPA fallback.
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    _mount_spa(app, settings.static_dir)
    app.add_middleware(ApiGuardMiddleware, secret=settings.session_secret, revoked=ctx.revoked)
    app.add_middleware(ProfilePathMiddleware)
    return app


def _mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend with SPA fallback, if it exists. Never under /api."""
    index = static_dir / "index.html"
    if not index.is_file():
        log.info("no frontend build found; serving API only")
        return
    root = static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str) -> Response:
        if full_path:
            candidate = (root / full_path).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                cache = (
                    "public, max-age=31536000, immutable"
                    if full_path.startswith("assets/")
                    else "no-cache"
                )
                return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

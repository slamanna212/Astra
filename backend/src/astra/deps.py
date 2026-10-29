"""Shared application context and FastAPI dependencies.

One process serves every profile. ``/api/...`` is the default profile; ``/api/profiles/<name>/...``
is that profile's own home. The context for a profile is built once and cached — a per-profile
``Settings`` (so every Hermes path derives from that home), its own ``StateDB``, ``ChatManager``
and cron broadcaster — while authentication state stays shared, because there is one login.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Request

from astra.auth import LoginRateLimiter, RevokedNonces
from astra.chat import ChatManager
from astra.config import Settings, activate_hermes_home
from astra.cron_events import CronEventBroadcaster
from astra.db import StateDB
from astra.openviking import OpenVikingClient
from astra.terminal import TerminalManager


@dataclass
class AppContext:
    settings: Settings
    db: StateDB
    limiter: LoginRateLimiter = field(default_factory=LoginRateLimiter)
    revoked: RevokedNonces = field(default_factory=RevokedNonces)
    cron_events: CronEventBroadcaster | None = None
    chat: ChatManager | None = None
    openviking: OpenVikingClient | None = None
    terminal: TerminalManager | None = None
    # Set by create_app once the registry exists (every context shares the one registry).
    profile_contexts: "ProfileContexts | None" = None

    def __post_init__(self) -> None:
        if self.cron_events is None:
            self.cron_events = CronEventBroadcaster(
                self.settings.paths.cron_jobs, poll_interval_s=self.settings.cron_poll_interval_s
            )
        if self.chat is None:
            self.chat = ChatManager(self.settings)
        if self.openviking is None:
            self.openviking = OpenVikingClient(self.settings)
        if self.terminal is None:
            self.terminal = TerminalManager(self.settings.workspace_dir)


class ProfileContexts:
    """Per-profile ``AppContext`` cache, keyed by profile name.

    Built lazily on first request and kept for the process lifetime: each context owns a
    session-database handle, an agent cache and a cron poller, none of which should be rebuilt
    per request.
    """

    def __init__(self, base: AppContext) -> None:
        self._base = base
        self._contexts: dict[str, AppContext] = {}
        self._lock = threading.Lock()

    @property
    def root(self) -> Path:
        return self._base.settings.hermes_home

    def home(self, name: str) -> Path:
        """Validated home for ``name`` (404 when it is not a profile)."""
        from astra.profiles import profile_home

        return profile_home(self.root, name)

    def get(self, name: str) -> AppContext:
        if name == "default":
            return self._base
        with self._lock:
            cached = self._contexts.get(name)
            if cached is not None:
                return cached
            home = self.home(name)
            settings = replace(self._base.settings, hermes_home=home)
            # Hermes resolves the home from the environment; make sure what is built for this
            # profile sees this profile's paths.
            activate_hermes_home(home)
            context = AppContext(
                settings=settings,
                db=StateDB(settings.paths.state_db),
                limiter=self._base.limiter,
                revoked=self._base.revoked,
            )
            self._contexts[name] = context
            return context

    async def drop(self, name: str) -> None:
        """Forget a profile's context (its home is about to be deleted)."""
        with self._lock:
            context = self._contexts.pop(name, None)
        if context is not None:
            await close_context(context)

    def loaded(self) -> dict[str, AppContext]:
        with self._lock:
            return dict(self._contexts)

    async def close(self) -> None:
        for context in list(self._contexts.values()):
            await close_context(context)
        self._contexts.clear()


async def close_context(ctx: AppContext) -> None:
    if ctx.terminal is not None:
        await ctx.terminal.close()
    if ctx.cron_events is not None:
        await ctx.cron_events.stop()
    if ctx.chat is not None:
        await ctx.chat.close()
    if ctx.openviking is not None:
        await ctx.openviking.close()
    ctx.db.close()


def get_ctx(request: Request) -> AppContext:
    name = request.scope.get("astra_profile") or request.path_params.get("profile")
    if not name or name == "default":
        return request.app.state.ctx
    contexts: ProfileContexts = request.app.state.contexts
    return contexts.get(name)


Ctx = Annotated[AppContext, Depends(get_ctx)]

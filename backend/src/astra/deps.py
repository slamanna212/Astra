"""Shared application context and FastAPI dependencies."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, Request

from astra.auth import LoginRateLimiter, RevokedNonces
from astra.chat import ChatManager
from astra.config import Settings
from astra.cron_events import CronEventBroadcaster
from astra.db import StateDB


@dataclass
class AppContext:
    settings: Settings
    db: StateDB
    limiter: LoginRateLimiter = field(default_factory=LoginRateLimiter)
    revoked: RevokedNonces = field(default_factory=RevokedNonces)
    cron_events: CronEventBroadcaster | None = None
    chat: ChatManager | None = None

    def __post_init__(self) -> None:
        if self.cron_events is None:
            self.cron_events = CronEventBroadcaster(
                self.settings.paths.cron_jobs, poll_interval_s=self.settings.cron_poll_interval_s
            )
        if self.chat is None:
            self.chat = ChatManager(self.settings)


def get_ctx(request: Request) -> AppContext:
    ctx: AppContext = request.app.state.ctx
    return ctx


Ctx = Annotated[AppContext, Depends(get_ctx)]

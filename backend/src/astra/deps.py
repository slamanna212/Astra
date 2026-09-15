"""Shared application context and FastAPI dependencies."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, Request

from astra.auth import LoginRateLimiter, RevokedNonces
from astra.config import Settings
from astra.db import StateDB


@dataclass
class AppContext:
    settings: Settings
    db: StateDB
    limiter: LoginRateLimiter = field(default_factory=LoginRateLimiter)
    revoked: RevokedNonces = field(default_factory=RevokedNonces)


def get_ctx(request: Request) -> AppContext:
    ctx: AppContext = request.app.state.ctx
    return ctx


Ctx = Annotated[AppContext, Depends(get_ctx)]

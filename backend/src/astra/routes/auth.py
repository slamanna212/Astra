from __future__ import annotations

import logging

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request, Response, status

from astra.auth import COOKIE_NAME, SESSION_TTL_SECONDS, issue_token, verify_password
from astra.deps import Ctx
from astra.models import AuthMe, LoginRequest

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(body: LoginRequest, request: Request, ctx: Ctx) -> Response:
    client = _client_key(request)
    retry_after = ctx.limiter.retry_after(client)
    if retry_after is not None:
        log.warning("login rate limited", extra={"client": client})
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts",
            headers={"Retry-After": str(retry_after)},
        )

    ok = await anyio.to_thread.run_sync(verify_password, body.password, ctx.settings.password_hash)
    if not ok:
        ctx.limiter.record_failure(client)
        log.warning("login failed", extra={"client": client})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    ctx.limiter.reset(client)
    value, _ = issue_token(ctx.settings.session_secret)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.set_cookie(
        COOKIE_NAME,
        value,
        max_age=SESSION_TTL_SECONDS,
        path="/",
        secure=ctx.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    log.info("login succeeded", extra={"client": client})
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, ctx: Ctx) -> Response:
    token = request.scope.get("state", {}).get("session_token")
    if token is not None:
        ctx.revoked.revoke(token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        COOKIE_NAME, path="/", secure=ctx.settings.cookie_secure, httponly=True, samesite="lax"
    )
    return response


@router.get("/me", response_model=AuthMe)
async def me() -> AuthMe:
    # ApiGuardMiddleware has already rejected unauthenticated requests with 401.
    return AuthMe(authenticated=True)

"""ASGI middleware enforcing auth + CSRF on ``/api/*``.

Implemented as pure ASGI (not BaseHTTPMiddleware) so it never buffers streaming/SSE responses.
"""

from __future__ import annotations

from http.cookies import CookieError, SimpleCookie

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from astra.auth import COOKIE_NAME, CSRF_HEADER, CSRF_VALUE, RevokedNonces, verify_token

# Reachable without a session. Logout is included so an expired cookie can still be cleared;
# it only ever removes the cookie.
PUBLIC_API_PATHS = frozenset({"/api/health", "/api/auth/login", "/api/auth/logout"})
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return value.decode("latin-1")
    return None


def read_session_cookie(scope: Scope) -> str | None:
    raw = _header(scope, b"cookie")
    if not raw:
        return None
    try:
        jar = SimpleCookie()
        jar.load(raw)
    except CookieError:
        return None
    morsel = jar.get(COOKIE_NAME)
    return morsel.value if morsel else None


class ApiGuardMiddleware:
    def __init__(self, app: ASGIApp, *, secret: bytes, revoked: RevokedNonces) -> None:
        self.app = app
        self.secret = secret
        self.revoked = revoked

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        if not (path == "/api" or path.startswith("/api/")):
            await self.app(scope, receive, send)
            return

        method: str = scope["method"].upper()
        if method not in SAFE_METHODS and _header(scope, CSRF_HEADER.encode()) != CSRF_VALUE:
            await JSONResponse({"detail": "CSRF check failed"}, status_code=403)(scope, receive, send)
            return

        token = verify_token(self.secret, read_session_cookie(scope))
        if token is not None and self.revoked.is_revoked(token):
            token = None
        scope.setdefault("state", {})["session_token"] = token

        if token is None and path not in PUBLIC_API_PATHS:
            await JSONResponse({"detail": "Not authenticated"}, status_code=401)(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_no_store)

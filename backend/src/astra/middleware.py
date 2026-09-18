"""ASGI middleware enforcing auth + CSRF on ``/api/*``.

Implemented as pure ASGI (not BaseHTTPMiddleware) so it never buffers streaming/SSE responses.

WebSockets under ``/api/*`` need the session cookie too. Browsers cannot attach the CSRF header to a
WebSocket handshake but *do* always send ``Origin``, so cross-site WebSocket hijacking is blocked by
requiring ``Origin`` to name this same host instead. Rejected handshakes are closed before accept,
which the server answers with a plain 403.
"""

from __future__ import annotations

from http.cookies import CookieError, SimpleCookie

from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from astra.auth import COOKIE_NAME, CSRF_HEADER, CSRF_VALUE, RevokedNonces, SessionToken, verify_token

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


def same_origin(scope: Scope) -> bool:
    origin = _header(scope, b"origin")
    host = _header(scope, b"host")
    if not origin or not host:
        return False
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() == host.lower()


class ApiGuardMiddleware:
    def __init__(self, app: ASGIApp, *, secret: bytes, revoked: RevokedNonces) -> None:
        self.app = app
        self.secret = secret
        self.revoked = revoked

    def _valid_token(self, scope: Scope) -> SessionToken | None:
        token = verify_token(self.secret, read_session_cookie(scope))
        if token is not None and self.revoked.is_revoked(token):
            return None
        return token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket" and scope["path"].startswith("/api/"):
            token = self._valid_token(scope)
            if token is None or not same_origin(scope):
                await send({"type": "websocket.close", "code": 1008})
                return
            scope.setdefault("state", {})["session_token"] = token
            await self.app(scope, receive, send)
            return
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

        token = self._valid_token(scope)
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

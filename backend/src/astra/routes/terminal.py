"""Embedded workspace terminal (see ``astra/terminal.py`` for the model and security notes).

``GET /api/terminal`` tells the UI whether the feature is enabled. ``/api/terminal/ws`` is the shell:
the middleware has already checked the session cookie and ``Origin`` before this handler runs.

Wire protocol:

* server → client **binary** frames are raw PTY output (xterm.js decodes UTF-8 itself, so a
  multi-byte character split across reads is never mangled);
* server → client text ``{"type": "exit", "code": int | null}`` when the shell ends;
* client → server text JSON: ``{"type": "input", "data": str}``, ``{"type": "resize", "rows": int,
  "cols": int}``.

``?restart=1`` on connect kills any running shell and starts a fresh one.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from astra.auth import verify_token
from astra.deps import Ctx
from astra.middleware import read_session_cookie
from astra.models import TerminalInfo
from astra.terminal import Terminal, TerminalUnavailable

router = APIRouter(prefix="/api/terminal", tags=["terminal"])
log = logging.getLogger(__name__)

# How often an open socket re-checks that its session is still valid (logout, expiry).
SESSION_RECHECK_S = 30.0
CLOSE_POLICY = 1008
CLOSE_DISABLED = 4403
CLOSE_UNAVAILABLE = 4503


@router.get("", response_model=TerminalInfo)
async def terminal_info(ctx: Ctx) -> TerminalInfo:
    return TerminalInfo(enabled=ctx.settings.terminal_enabled)


def _session_valid(websocket: WebSocket) -> bool:
    ctx = websocket.app.state.ctx
    token = verify_token(ctx.settings.session_secret, read_session_cookie(websocket.scope))
    return token is not None and not ctx.revoked.is_revoked(token)


async def _pump_output(websocket: WebSocket, term: Terminal, queue: asyncio.Queue[bytes | None]) -> None:
    while True:
        item = await queue.get()
        if item is None:
            await websocket.send_text(json.dumps({"type": "exit", "code": term.exit_code}))
            return
        # Coalesce whatever else is already queued into one frame.
        chunks = [item]
        while not queue.empty():
            nxt = queue.get_nowait()
            if nxt is None:
                queue.put_nowait(None)
                break
            chunks.append(nxt)
        await websocket.send_bytes(b"".join(chunks))


async def _pump_input(websocket: WebSocket, term: Terminal) -> None:
    last_check = time.monotonic()
    while True:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=SESSION_RECHECK_S)
        except TimeoutError:
            raw = None
        if time.monotonic() - last_check >= SESSION_RECHECK_S or raw is None:
            last_check = time.monotonic()
            if not _session_valid(websocket):
                await websocket.close(code=CLOSE_POLICY)
                return
        if raw is None:
            continue
        try:
            msg = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(msg, dict):
            continue
        kind = msg.get("type")
        if kind == "input" and isinstance(msg.get("data"), str):
            term.write(msg["data"].encode("utf-8", "replace"))
        elif kind == "resize":
            with contextlib.suppress(TypeError, ValueError):
                term.resize(int(msg.get("rows")), int(msg.get("cols")))


@router.websocket("/ws")
async def terminal_ws(
    websocket: WebSocket,
    rows: Annotated[int, Query()] = 24,
    cols: Annotated[int, Query()] = 80,
    restart: Annotated[bool, Query()] = False,
) -> None:
    ctx = websocket.app.state.ctx
    await websocket.accept()
    if not ctx.settings.terminal_enabled:
        await websocket.close(code=CLOSE_DISABLED, reason="terminal is disabled")
        return
    try:
        term = await ctx.terminal.get_or_start(rows, cols, restart=restart)
    except (TerminalUnavailable, OSError) as exc:
        log.warning("terminal start failed: %s", exc)
        await websocket.close(code=CLOSE_UNAVAILABLE, reason="terminal could not be started")
        return

    queue, backlog = term.attach()
    tasks: list[asyncio.Task[None]] = []
    try:
        if backlog:
            await websocket.send_bytes(backlog)
        tasks = [
            asyncio.create_task(_pump_output(websocket, term, queue)),
            asyncio.create_task(_pump_input(websocket, term)),
        ]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            exc = task.exception()
            if exc is not None and not isinstance(exc, WebSocketDisconnect):
                log.warning("terminal socket error: %s", type(exc).__name__)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        term.detach(queue)
        with contextlib.suppress(Exception):
            await websocket.close()

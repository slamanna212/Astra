from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Callable

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from astra.terminal import IDLE_GRACE_S
from tests.conftest import login

ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    root.mkdir()
    # Deterministic shell: no user rc files, no user prompt customisation.
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("SHELL", shutil.which("bash") or "/bin/sh")
    monkeypatch.setenv("ASTRA_SESSION_SECRET", "must-not-leak")
    return root


@pytest.fixture
def term_client(make_client: Callable[..., TestClient], workspace: Path) -> TestClient:
    client = make_client(workspace_dir=workspace, terminal_enabled=True)
    login(client)
    return client


def read_until(ws: WebSocketTestSession, needle: str, limit: int = 500) -> str:
    seen = ""
    for _ in range(limit):
        msg = ws.receive()
        if msg.get("bytes"):
            seen += msg["bytes"].decode("utf-8", "replace")
        elif msg.get("text"):
            seen += msg["text"]
        if needle in seen:
            return seen
    raise AssertionError(f"{needle!r} not found in {seen!r}")


def send_line(ws: WebSocketTestSession, line: str) -> None:
    ws.send_text(json.dumps({"type": "input", "data": line + "\n"}))


def test_info_reports_disabled_by_default(make_client: Callable[..., TestClient]) -> None:
    client = make_client()
    login(client)
    assert client.get("/api/terminal").json() == {"enabled": False}


def test_disabled_socket_closes(make_client: Callable[..., TestClient]) -> None:
    client = make_client()
    login(client)
    with client.websocket_connect("/api/terminal/ws", headers=ORIGIN) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_bytes()
    assert exc.value.code == 4403


def test_socket_requires_login(make_client: Callable[..., TestClient], workspace: Path) -> None:
    client = make_client(workspace_dir=workspace, terminal_enabled=True)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/terminal/ws", headers=ORIGIN):
            pass
    assert exc.value.code == 1008


@pytest.mark.parametrize("headers", [{}, {"origin": "http://evil.example"}, {"origin": "null"}])
def test_socket_requires_same_origin(term_client: TestClient, headers: dict[str, str]) -> None:
    with pytest.raises(WebSocketDisconnect) as exc:
        with term_client.websocket_connect("/api/terminal/ws", headers=headers):
            pass
    assert exc.value.code == 1008


def test_shell_runs_in_workspace_without_astra_env(term_client: TestClient, workspace: Path) -> None:
    with term_client.websocket_connect("/api/terminal/ws?rows=30&cols=100", headers=ORIGIN) as ws:
        send_line(ws, 'echo "cwd=$(pwd) secret=[$ASTRA_SESSION_SECRET] sum=$((40+2))"')
        out = read_until(ws, "sum=42")
        assert f"cwd={workspace}" in out
        assert "secret=[]" in out
        assert "no job control" not in out  # the pty is the shell's controlling terminal
        send_line(ws, "stty size")
        read_until(ws, "30 100")
        ws.send_text(json.dumps({"type": "resize", "rows": 40, "cols": 120}))
        send_line(ws, "stty size")
        read_until(ws, "40 120")
        send_line(ws, "exit")
        read_until(ws, '"type": "exit"')


def test_reattach_replays_backlog_and_keeps_shell(term_client: TestClient) -> None:
    with term_client.websocket_connect("/api/terminal/ws", headers=ORIGIN) as ws:
        send_line(ws, "export KEEP=still-here; echo marker-$((6*7))")
        read_until(ws, "marker-42")
    with term_client.websocket_connect("/api/terminal/ws", headers=ORIGIN) as ws:
        read_until(ws, "marker-42")  # replayed backlog
        send_line(ws, 'echo "keep=$KEEP"')
        read_until(ws, "keep=still-here")


def test_restart_starts_fresh_shell(term_client: TestClient) -> None:
    with term_client.websocket_connect("/api/terminal/ws", headers=ORIGIN) as ws:
        send_line(ws, "export KEEP=old; echo ready-$((1+1))")
        read_until(ws, "ready-2")
    with term_client.websocket_connect("/api/terminal/ws?restart=true", headers=ORIGIN) as ws:
        send_line(ws, 'echo "keep=[$KEEP]"')
        read_until(ws, "keep=[]")


def test_idle_terminal_is_reaped(term_client: TestClient) -> None:
    with term_client.websocket_connect("/api/terminal/ws", headers=ORIGIN) as ws:
        send_line(ws, "echo up-$((2+2))")
        read_until(ws, "up-4")
    manager = term_client.app.state.ctx.terminal
    term = manager.current
    assert term is not None and term.unwatched_since is not None
    assert manager.reap_idle(term.unwatched_since + 1) is False
    # Closing touches the event loop's reader registry, so run it on the app's loop.
    assert term_client.portal.call(_reap, manager, term.unwatched_since + IDLE_GRACE_S + 1) is True
    assert manager.current is None


async def _reap(manager, now: float) -> bool:  # noqa: ANN001
    return manager.reap_idle(now)

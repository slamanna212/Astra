from __future__ import annotations

import asyncio
import threading
from typing import Any

import pytest

import astra.chat as chatmod
from astra.chat import ChatManager


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeSessionDB:
    def __init__(self, _path) -> None:
        self.closed = False

    def get_messages_as_conversation(self, _session_id: str) -> list[dict[str, str]]:
        return [{"role": "assistant", "content": "existing canonical history"}]

    def close(self) -> None:
        self.closed = True


class FakeApprovals:
    def __init__(self) -> None:
        self.callbacks: dict[str, Any] = {}
        self.resolved = threading.Event()

    def register_gateway_notify(self, key: str, callback) -> None:
        self.callbacks[key] = callback

    def unregister_gateway_notify(self, key: str) -> None:
        self.callbacks.pop(key, None)

    def get_pending_gateway_approval(self, _key: str):
        return None

    def resolve_gateway_approval(self, key: str, choice: str, **kwargs) -> int:
        assert key == "session-1"
        assert choice in {"once", "session", "always", "deny"}
        assert kwargs["request_id"] == "approval-1"
        self.resolved.set()
        return 1


class FakeAgent:
    instances: list["FakeAgent"] = []
    release = threading.Event()
    interrupted = threading.Event()

    def __init__(self, **kwargs) -> None:
        self.__dict__.update(kwargs)
        self._pending_steer: str | None = None
        self.commits: list[list[dict[str, str]]] = []
        FakeAgent.instances.append(self)

    def run_conversation(self, user_message: str, conversation_history=None, **_kwargs):
        assert user_message
        assert conversation_history
        self.stream_delta_callback("hello")
        answer = self.clarify_callback("Which environment?", ["dev", "prod"])
        if FakeAgent.interrupted.is_set():
            return "interrupted"
        assert answer == "dev"
        approvals.callbacks[self.session_id](
            {"request_id": "approval-1", "command": "deploy dev", "description": "Deploy?", "secret": "never"}
        )
        assert approvals.resolved.wait(2)
        FakeAgent.release.wait(2)
        return "complete"

    def steer(self, text: str) -> bool:
        self._pending_steer = text
        return True

    def _drain_pending_steer(self):
        value, self._pending_steer = self._pending_steer, None
        return value

    def clear_interrupt(self) -> None:
        FakeAgent.interrupted.clear()

    def hard_interrupt(self, **_kwargs) -> None:
        FakeAgent.interrupted.set()
        FakeAgent.release.set()

    def commit_memory_session(self, history) -> None:
        self.commits.append(history)


approvals = FakeApprovals()


@pytest.fixture
def fake_hermes(monkeypatch):
    FakeAgent.instances.clear()
    FakeAgent.release.clear()
    FakeAgent.interrupted.clear()
    approvals.callbacks.clear()
    approvals.resolved.clear()
    monkeypatch.setattr(chatmod, "agent_class", lambda: FakeAgent)
    monkeypatch.setattr(chatmod, "session_db_class", lambda: FakeSessionDB)
    monkeypatch.setattr(chatmod, "approval_module", lambda: approvals)
    monkeypatch.setattr(chatmod, "redact_approval_command", lambda value: str(value))
    monkeypatch.setattr(
        chatmod,
        "resolve_runtime_provider",
        lambda: lambda **_kwargs: {"provider": "fake", "base_url": "https://invalid", "api_key": "key"},
    )
    monkeypatch.setattr(chatmod, "_load_chat_config", lambda _path: {"model": {"default": "fake-model"}})


async def next_named(queue: asyncio.Queue, name: str):
    while True:
        event = await asyncio.wait_for(queue.get(), 2)
        if event.name == name:
            return event


@pytest.mark.anyio
async def test_turn_fans_out_clarify_approval_late_steer_and_commits(base_settings, fake_hermes):
    manager = ChatManager(base_settings, max_workers=1)
    await manager.start("session-1", "go", model=None, provider=None)
    first, running = await manager.subscribe("session-1")
    second, running_second = await manager.subscribe("session-1")
    assert running and running_second

    clarify_a, clarify_b = await asyncio.gather(next_named(first, "clarify"), next_named(second, "clarify"))
    assert clarify_a.data == clarify_b.data
    assert await manager.answer("session-1", clarify_a.data["id"], "dev")

    approval_a, approval_b = await asyncio.gather(next_named(first, "approval"), next_named(second, "approval"))
    assert approval_a.data == approval_b.data
    assert "secret" not in approval_a.data
    assert await manager.approve("session-1", "approval-1", "once", None)
    assert await manager.steer("session-1", "remember this if too late")
    FakeAgent.release.set()

    done_a, done_b = await asyncio.gather(next_named(first, "done"), next_named(second, "done"))
    assert done_a.data == done_b.data
    assert done_a.data["late_steer"] == "remember this if too late"
    assert done_a.seq == done_b.seq
    for _ in range(50):
        if not await manager.is_running("session-1"):
            break
        await asyncio.sleep(0.01)
    assert not await manager.is_running("session-1")

    # A second turn on the same identity reuses the same Hermes instance.
    approvals.resolved.clear()
    FakeAgent.release.clear()
    await manager.start("session-1", "again", model=None, provider=None)
    third, _ = await manager.subscribe("session-1", after_seq=done_a.seq)
    clarify = await next_named(third, "clarify")
    await manager.answer("session-1", clarify.data["id"], "dev")
    await next_named(third, "approval")
    await manager.approve("session-1", "approval-1", "once", None)
    FakeAgent.release.set()
    await next_named(third, "done")
    assert len(FakeAgent.instances) == 1

    await manager.close()
    assert FakeAgent.instances[0].commits


@pytest.mark.anyio
async def test_stop_interrupts_the_agent(base_settings, fake_hermes):
    manager = ChatManager(base_settings, max_workers=1)
    await manager.start("session-1", "go", model=None, provider=None)
    subscriber, _ = await manager.subscribe("session-1")
    clarify = await next_named(subscriber, "clarify")
    # Stop also unblocks a pending clarify callback.
    assert await manager.stop("session-1")
    cancelled = await next_named(subscriber, "cancel")
    assert cancelled.data["reason"] == "Cancelled by user"
    assert FakeAgent.interrupted.is_set()
    await manager.close()


@pytest.mark.anyio
async def test_commit_idle_is_a_non_request_thread_session_boundary(base_settings, fake_hermes):
    manager = ChatManager(base_settings, max_workers=1)
    FakeAgent.release.set()
    approvals.resolved.set()
    # Use the normal builder to populate the identity-aware cache, without a provider call.
    turn = chatmod.Turn("session-1", "go", None, None)
    agent = await asyncio.to_thread(manager._build_agent, turn)
    assert not agent.commits
    await manager.commit_idle()
    assert agent.commits
    assert not manager._agents
    await manager.close()


def test_chat_state_and_options_are_canonical_and_do_not_expose_keys(authed):
    session_id = authed.get("/api/sessions", params={"limit": 1}).json()["items"][0]["id"]
    state = authed.get(f"/api/chat/{session_id}/state")
    assert state.status_code == 200
    assert state.json() == {"running": False}
    options = authed.get(f"/api/chat/{session_id}/options")
    assert options.status_code == 200
    payload = options.json()
    assert set(payload) == {"default_model", "default_provider", "models", "providers"}
    assert "api_key" not in options.text
    assert authed.get("/api/chat/not-a-session/state").status_code == 404

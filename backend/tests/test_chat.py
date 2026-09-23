from __future__ import annotations

import asyncio
import sqlite3
import sys
import threading
import time
import types
from typing import Any

import pytest

import astra.chat as chatmod
from astra.chat import ChatManager

from .conftest import CSRF


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
    instances: list[FakeAgent] = []
    release = threading.Event()
    interrupted = threading.Event()

    def __init__(self, **kwargs) -> None:
        # The deployed Hermes AIAgent hands ``session_db`` to its own persistence delegate
        # and keeps NO public attribute for it (v2026.8.31 only assigns ``_session_db`` on the
        # lazy recall path). Mirror that here: if Astra reads a store it did not create, the
        # suite must fail the same way production does.
        kwargs.pop("session_db", None)
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
async def test_event_batches_preserve_order_and_reconnect_replay(base_settings, monkeypatch):
    manager = ChatManager(base_settings)
    turn = chatmod.Turn("batch-session", "go", None, None)
    manager._turns[turn.session_id] = turn
    first, _ = await manager.subscribe(turn.session_id)
    for index in range(350):
        manager._emit(turn, "delta", {"text": str(index)})
    manager._emit(turn, "done", {})
    turn.done.set()

    original = chatmod.anyio.to_thread.run_sync
    release = asyncio.Event()
    dispatches = 0

    async def dispatch(fn, *args, **kwargs):
        nonlocal dispatches
        dispatches += 1
        if dispatches == 2:
            await release.wait()
        return await original(fn, *args, **kwargs)

    monkeypatch.setattr(chatmod.anyio.to_thread, "run_sync", dispatch)
    pump = asyncio.create_task(manager._pump(turn))
    try:
        received = [await asyncio.wait_for(first.get(), 2)]
        second, running = await manager.subscribe(turn.session_id, after_seq=received[0].seq)
        assert running
        release.set()
        await asyncio.wait_for(pump, 2)
        while not first.empty():
            received.append(first.get_nowait())
        replayed = []
        while not second.empty():
            replayed.append(second.get_nowait())
        assert [event.seq for event in received] == list(range(1, 352))
        assert replayed == received[1:]
        assert received[-1].name == "done"
        assert received[:-1] == turn.recent[:-1]
        assert dispatches < 5
    finally:
        release.set()
        await pump
        await manager.close()


@pytest.mark.anyio
async def test_sparse_event_does_not_wait_for_a_full_batch(base_settings):
    manager = ChatManager(base_settings)
    turn = chatmod.Turn("sparse-session", "go", None, None)
    manager._turns[turn.session_id] = turn
    subscriber, _ = await manager.subscribe(turn.session_id)
    pump = asyncio.create_task(manager._pump(turn))
    try:
        manager._emit(turn, "delta", {"text": "first token"})
        event = await asyncio.wait_for(subscriber.get(), 2)
        assert event.data == {"text": "first token"}
        assert not turn.done.is_set()
    finally:
        turn.done.set()
        await pump
        await manager.close()


@pytest.mark.anyio
async def test_turn_fans_out_clarify_approval_late_steer_and_commits(base_settings, fake_hermes):
    manager = ChatManager(base_settings, max_workers=1)
    await manager.start("session-1", "go", model=None, provider=None)
    first, running = await manager.subscribe("session-1")
    second, running_second = await manager.subscribe("session-1")
    assert running and running_second

    clarify_a, clarify_b = await asyncio.gather(next_named(first, "clarify"), next_named(second, "clarify"))
    assert clarify_a.data == clarify_b.data
    assert await manager.active_turns() == [("session-1", "chat", True)]
    assert await manager.answer("session-1", clarify_a.data["id"], "dev")

    approval_a, approval_b = await asyncio.gather(next_named(first, "approval"), next_named(second, "approval"))
    assert approval_a.data == approval_b.data
    assert "secret" not in approval_a.data
    assert await manager.approve("session-1", "approval-1", "once", None)
    assert await manager.steer("session-1", "remember this if too late")
    FakeAgent.release.set()

    assert await manager.active_turns() == [("session-1", "chat", False)]
    done_a, done_b = await asyncio.gather(next_named(first, "done"), next_named(second, "done"))
    assert done_a.data == done_b.data
    assert done_a.data["late_steer"] == "remember this if too late"
    assert done_a.seq == done_b.seq
    for _ in range(50):
        if not await manager.is_running("session-1"):
            break
        await asyncio.sleep(0.01)
    assert not await manager.is_running("session-1")
    assert await manager.active_turns() == []

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
    await next_named(subscriber, "clarify")
    # Stop also unblocks a pending clarify callback.
    assert await manager.stop("session-1")
    cancelled = await next_named(subscriber, "cancel")
    assert cancelled.data["reason"] == "Cancelled by user"
    assert FakeAgent.interrupted.is_set()
    await manager.close()


@pytest.mark.anyio
async def test_returned_provider_failure_is_reported_as_an_error(base_settings, fake_hermes, monkeypatch):
    # Hermes returns (does not raise) non-retryable provider failures such as a 402 billing wall.
    def billing_failure(self, user_message: str, conversation_history=None, **_kwargs):
        return {
            "final_response": "Insufficient Balance\n\nTop up your provider account.",
            "completed": False,
            "failed": True,
            "error": "Error code: 402",
            "failure_reason": "billing",
        }

    monkeypatch.setattr(FakeAgent, "run_conversation", billing_failure)
    manager = ChatManager(base_settings, max_workers=1)
    await manager.start("session-1", "go", model=None, provider=None)
    subscriber, _ = await manager.subscribe("session-1")
    error = await next_named(subscriber, "error")
    assert error.data["message"] == "Insufficient Balance\n\nTop up your provider account."
    assert error.data["error_type"] == "billing"
    await manager.close()


@pytest.mark.anyio
async def test_commit_idle_is_a_non_request_thread_session_boundary(base_settings, fake_hermes):
    manager = ChatManager(base_settings, max_workers=1)
    FakeAgent.release.set()
    approvals.resolved.set()
    # Use the normal builder to populate the identity-aware cache, without a provider call.
    turn = chatmod.Turn("session-1", "go", None, None, reasoning_effort="high")
    agent = await asyncio.to_thread(manager._build_agent, turn)
    assert agent.reasoning_config == {"enabled": True, "effort": "high"}
    # Hermes' shared turn prologue uses this surface identity to run its canonical
    # opening-turn auto-title path. Astra deliberately adds no periodic title calls.
    assert agent.platform == "webui"
    assert isinstance(turn.session_db, FakeSessionDB)
    assert not agent.commits
    await manager.commit_idle()
    assert agent.commits
    assert not manager._agents
    await manager.close()


@pytest.mark.anyio
async def test_live_tps_is_a_sliding_window_not_a_since_start_average(base_settings, monkeypatch):
    manager = ChatManager(base_settings, max_workers=1)
    turn = chatmod.Turn("session-x", "go", None, None)
    clock = [0.0]
    monkeypatch.setattr(chatmod.time, "monotonic", lambda: clock[0])

    # Five deltas 0.25s apart: a steady 4 tok/s the window should report throughout.
    for _ in range(5):
        manager._token_callback(turn, "a")
        clock[0] += 0.25
    steady = [turn.events.get_nowait().data.get("tps") for _ in range(5)]
    assert steady[0] is None  # not enough samples yet for a rate
    assert steady[1:] == [pytest.approx(4.0)] * 4

    # A long gap pushes every prior sample out of the window, so the next delta alone can't
    # yield a rate; only once a second delta lands inside the window does it recompute fresh,
    # reflecting the new (slower) pace rather than an average blended with the fast burst above.
    clock[0] += 3.0
    manager._token_callback(turn, "b")
    assert "tps" not in turn.events.get_nowait().data
    clock[0] += 2.0
    manager._token_callback(turn, "c")
    assert turn.events.get_nowait().data["tps"] == pytest.approx(0.5)

    await manager.close()


@pytest.mark.anyio
async def test_live_tps_counts_reasoning_chunks(base_settings, monkeypatch):
    manager = ChatManager(base_settings, max_workers=1)
    turn = chatmod.Turn("session-x", "go", None, None)
    clock = [0.0]
    monkeypatch.setattr(chatmod.time, "monotonic", lambda: clock[0])

    # A thinking model spends most of a turn in reasoning; the rate must cover it and carry
    # over seamlessly into the answer.
    for _ in range(3):
        manager._reasoning_callback(turn, "r")
        clock[0] += 0.25
    manager._token_callback(turn, "a")
    events = [turn.events.get_nowait() for _ in range(4)]
    assert [event.name for event in events] == ["reasoning"] * 3 + ["delta"]
    assert "tps" not in events[0].data
    assert [event.data["tps"] for event in events[1:]] == [pytest.approx(4.0)] * 3

    await manager.close()


@pytest.mark.anyio
async def test_final_usage_averages_output_tokens_over_the_whole_turn(base_settings, monkeypatch):
    manager = ChatManager(base_settings, max_workers=1)
    turn = chatmod.Turn("session-x", "go", None, None)
    clock = [100.0]
    monkeypatch.setattr(chatmod.time, "monotonic", lambda: clock[0])
    turn.started_at = 100.0
    turn.start_output_tokens = 10
    turn.agent = type("Agent", (), {"session_completion_tokens": 10})()

    assert manager._final_usage(turn) == {}  # nothing generated yet for this turn

    clock[0] = 105.0
    turn.agent.session_completion_tokens = 60
    assert manager._final_usage(turn) == {"output_tokens": 50, "tps": 10.0}

    await manager.close()


@pytest.mark.anyio
async def test_manual_compaction_streams_status_and_archives_history(base_settings, monkeypatch):
    class CompactDB:
        def __init__(self):
            self.archived = None

        def get_messages_as_conversation(self, _session_id):
            return [
                {"role": "user", "content": "one"},
                {"role": "assistant", "content": "two"},
                {"role": "user", "content": "three"},
                {"role": "assistant", "content": "four"},
                {"role": "user", "content": "five"},
            ]

        def get_active_message_watermark(self, _session_id):
            return 42

        def archive_and_compact(self, session_id, messages, *, watermark, tail_count):
            self.archived = (session_id, messages, watermark, tail_count)

    class Compressor:
        def compress(self, messages, *, focus_topic, force):
            assert focus_topic == "deployment"
            assert force is True
            return [messages[0], {"role": "assistant", "content": "summary"}, messages[-1]]

    db = CompactDB()
    # Mirrors the deployed AIAgent: it holds the compressor but no public reference to
    # the session store, which Astra attaches to the turn instead.
    agent = type("CompactAgent", (), {"context_compressor": Compressor()})()

    def build(turn):
        turn.session_db = db
        return agent

    manager = ChatManager(base_settings, max_workers=1)
    monkeypatch.setattr(manager, "_build_agent", build)

    await manager.start_compaction("session-1", "deployment", model=None, provider=None)
    subscriber, running = await manager.subscribe("session-1")
    assert running
    status = await next_named(subscriber, "status")
    done = await next_named(subscriber, "done")

    assert status.data["kind"] == "compacting"
    assert done.data["before_messages"] == 5
    assert done.data["after_messages"] == 3
    assert db.archived == ("session-1", [
        {"role": "user", "content": "one"},
        {"role": "assistant", "content": "summary"},
        {"role": "user", "content": "five"},
    ], 42, 0)
    await manager.close()


def test_compression_exhaustion_classifier_handles_structured_and_legacy_errors():
    assert ChatManager._is_compression_exhausted({"compression_exhausted": True})
    assert ChatManager._is_compression_exhausted(RuntimeError("context compression exhausted"))
    assert not ChatManager._is_compression_exhausted({"failed": True, "error": "rate limited"})


@pytest.mark.anyio
async def test_codex_context_notice_is_information_not_active_compaction(base_settings):
    manager = ChatManager(base_settings, max_workers=1)
    turn = chatmod.Turn("session-x", "test message", "gpt-5.6-luna", "openai-codex")
    manager._status_callback(
        turn,
        "lifecycle",
        "ℹ Codex gpt-5.6-luna caps context at 272K, so auto-compaction was raised "
        "to 85% (from 50%) to use more of the window before summarizing.\n"
        "  Opt back out: hermes config set compression.codex_gpt55_autoraise false",
    )
    notice = turn.events.get_nowait()
    assert notice.name == "status"
    assert notice.data == {
        "kind": "status",
        "message": "ℹ Hermes is using a 272K context limit for this Codex gpt-5.6-luna "
        "session. Its auto-compaction threshold is 85% (instead of 50%).\n"
        "  Opt back out: hermes config set compression.codex_gpt55_autoraise false",
    }

    manager._status_callback(turn, "compacting", "Compacting context — summarizing earlier conversation…")
    assert turn.events.get_nowait().data["kind"] == "compacting"
    manager._status_callback(turn, "compacted", "Context compaction complete.")
    assert turn.events.get_nowait().data["kind"] == "compacted"
    await manager.close()


def test_chat_state_and_options_are_canonical_and_do_not_expose_keys(authed):
    session_id = authed.get("/api/sessions", params={"limit": 1}).json()["items"][0]["id"]
    state = authed.get(f"/api/chat/{session_id}/state")
    assert state.status_code == 200
    assert state.json() == {"running": False, "recovery_available": False}
    options = authed.get(f"/api/chat/{session_id}/options")
    assert options.status_code == 200
    payload = options.json()
    assert set(payload) == {"default_model", "default_provider", "models", "providers"}
    assert "api_key" not in options.text
    assert authed.get("/api/chat/not-a-session/state").status_code == 404


def test_active_route_lists_running_turns(authed, monkeypatch):
    assert authed.get("/api/chat/active").json() == {"turns": []}

    async def active_turns():
        return [("s-run", "chat", False), ("s-wait", "compact", True)]

    monkeypatch.setattr(authed.app.state.ctx.chat, "active_turns", active_turns)
    assert authed.get("/api/chat/active").json() == {
        "turns": [
            {"session_id": "s-run", "operation": "chat", "waiting": False},
            {"session_id": "s-wait", "operation": "compact", "waiting": True},
        ]
    }


def test_compact_route_starts_a_streamed_manual_compaction(authed, monkeypatch):
    session_id = authed.get("/api/sessions", params={"limit": 1}).json()["items"][0]["id"]
    calls = []

    async def start_compaction(session_id, focus_topic, *, model, provider):
        calls.append((session_id, focus_topic, model, provider))

    monkeypatch.setattr(authed.app.state.ctx.chat, "start_compaction", start_compaction)
    response = authed.post(
        f"/api/chat/{session_id}/compact",
        json={"focus_topic": "deployment", "model": "test-model", "provider": "test-provider"},
        headers=CSRF,
    )

    assert response.status_code == 202
    assert response.json() == {"running": True}
    assert calls == [(session_id, "deployment", "test-model", "test-provider")]


def test_context_recovery_creates_empty_focused_continuation(authed, monkeypatch):
    session_id = authed.get("/api/sessions", params={"limit": 1}).json()["items"][0]["id"]

    class RecoveryDB:
        def __init__(self, path):
            self.conn = sqlite3.connect(path)
            self.conn.row_factory = sqlite3.Row

        def get_session(self, target):
            row = self.conn.execute("SELECT * FROM sessions WHERE id = ?", (target,)).fetchone()
            return dict(row) if row else None

        def create_session(self, target, source, **kwargs):
            self.conn.execute(
                "INSERT INTO sessions (id, source, model, system_prompt, parent_session_id, started_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (target, source, kwargs.get("model"), kwargs.get("system_prompt"), kwargs.get("parent_session_id"), time.time()),
            )
            self.conn.commit()

        def set_session_title(self, target, title):
            self.conn.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, target))
            self.conn.commit()
            return True

        def delete_session(self, target):
            self.conn.execute("DELETE FROM sessions WHERE id = ?", (target,))
            self.conn.commit()

        def close(self):
            self.conn.close()

    monkeypatch.setattr("astra.routes.sessions.session_db_class", lambda: RecoveryDB)
    authed.app.state.ctx.chat._compression_recovery.add(session_id)
    response = authed.post(f"/api/sessions/{session_id}/recover-context", headers=CSRF)

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["parent_session_id"] == session_id
    assert payload["source"] == "webui"
    assert payload["message_count"] == 0
    assert payload["title"].endswith("(focused continuation)")
    assert not authed.app.state.ctx.chat.recovery_available(session_id)

    with sqlite3.connect(authed.app.state.ctx.settings.paths.state_db) as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (payload["id"],))


def test_regenerate_rewinds_selected_response_and_starts_replacement(
    authed, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: dict[str, Any] = {}

    class RewindDB:
        def __init__(self, _path) -> None:
            pass

        def close(self) -> None:
            pass

        def get_active_message_ids(self, session_id: str) -> list[int]:
            assert session_id == "session-1"
            return [10, 11]

        def get_messages_as_conversation(self, session_id: str, include_row_ids: bool):
            assert session_id == "session-1" and include_row_ids
            return [
                {"_row_id": 10, "role": "user", "content": "Try this again"},
                {"_row_id": 11, "role": "assistant", "content": "First answer"},
            ]

        def rewind_to_message(self, session_id: str, message_id: int, **kwargs):
            calls["rewind"] = (session_id, message_id, kwargs)
            return {"rewound_count": 2, "target_message": {}, "new_head_id": None}

    monkeypatch.setattr("astra.routes.sessions.session_db_class", lambda: RewindDB)
    agent_module = types.ModuleType("agent")
    compressor_module = types.ModuleType("agent.context_compressor")
    compressor_module.user_originated_turn_view = lambda message: message if message.get("role") == "user" else None
    compressor_module.split_user_originated_turn = lambda message: (None, message)
    compressor_module.retryable_user_text = lambda content: content if isinstance(content, str) else ""
    monkeypatch.setitem(sys.modules, "agent", agent_module)
    monkeypatch.setitem(sys.modules, "agent.context_compressor", compressor_module)

    async def start_after_prepare(session_id, prepare, *, model, provider, reasoning_effort):
        calls["start"] = (session_id, await asyncio.to_thread(prepare), model, provider, reasoning_effort)

    monkeypatch.setattr(authed.app.state.ctx.chat, "start_after_prepare", start_after_prepare)
    response = authed.post(
        "/api/chat/session-1/regenerate",
        json={"message_id": 11, "model": "test-model", "provider": "test-provider", "reasoning_effort": "high"},
        headers=CSRF,
    )

    assert response.status_code == 202, response.text
    assert response.json() == {"running": True}
    assert calls["start"] == ("session-1", "Try this again", "test-model", "test-provider", "high")
    assert calls["rewind"][0:2] == ("session-1", 10)
    assert calls["rewind"][2]["expected_active_ids"] == [10, 11]


@pytest.mark.anyio
async def test_tool_progress_is_emitted_as_structured_fields(base_settings, monkeypatch):
    manager = ChatManager(base_settings)
    turn = chatmod.Turn("tool-session", "go", None, None)
    emitted: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(manager, "_emit", lambda _turn, name, data: emitted.append((name, data)))
    try:
        manager._tool_callback(turn, "tool.started", "terminal", "ls -la", {"command": "ls -la"})
        manager._tool_callback(
            turn, "tool.completed", "terminal", None, None, duration=1.23456, is_error=False, result="ok",
        )
        manager._tool_callback(turn, "reasoning.available", "_thinking", "hmm", None)
        manager._tool_callback(turn, "_thinking", "first line")
        manager._tool_callback(turn, "tool.started", "write_file", None, {"content": "x" * 10_000})
        manager._tool_callback(turn, "something.new", 42)
    finally:
        await manager.close()

    assert emitted[0] == ("tool", {
        "event": "tool.started", "name": "terminal", "preview": "ls -la", "arguments": {"command": "ls -la"},
    })
    assert emitted[1] == ("tool", {
        "event": "tool.completed", "name": "terminal", "duration": 1.235, "is_error": False, "result": "ok",
    })
    # Reasoning callbacks are not tool activity; oversized args are bounded; unknown shapes survive.
    assert emitted[2][1]["name"] == "write_file"
    assert isinstance(emitted[2][1]["arguments"], str) and len(emitted[2][1]["arguments"]) <= 4097
    assert emitted[3] == ("tool", {"args": ["something.new", "42"]})
    assert len(emitted) == 4

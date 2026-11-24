"""Subagent completion delivery (astra.completions).

Hermes detaches every top-level ``delegate_task`` and hands the result back on a process-global
queue. These tests pin the routing/retry contract of the consumer that drains it — the part that
used to be missing on this surface, so completions were dropped silently.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from astra import completions
from astra.chat import ChatError, SessionBusy
from astra.completions import CompletionConsumer


@dataclass
class FakeChat:
    busy: bool = False
    failure: Exception | None = None
    started: list[tuple[str, str, dict[str, Any]]] | None = None

    async def is_running(self, session_id: str) -> bool:
        return self.busy

    async def start_completion_turn(self, session_id: str, message: str, **kwargs: Any) -> None:
        if self.failure is not None:
            raise self.failure
        self.started = self.started or []
        self.started.append((session_id, message, kwargs))


def _db(path: Path, rows: list[tuple[str, str, str]]) -> Path:
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT DEFAULT '', parent_session_id TEXT DEFAULT '')"
        )
        conn.executemany("INSERT INTO sessions (id, source, parent_session_id) VALUES (?, ?, ?)", rows)
        conn.commit()
    finally:
        conn.close()
    return path


def _consumer(tmp_path: Path, chat: FakeChat, *, sessions: list[tuple[str, str, str]] | None = None) -> CompletionConsumer:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    _db(home / "state.db", sessions if sessions is not None else [("sess-1", "", "")])
    settings = SimpleNamespace(hermes_home=home)
    base = SimpleNamespace(settings=settings, chat=chat)
    return CompletionConsumer(base, SimpleNamespace(get=lambda name: base), startup_delay=0.0)


def _event(**overrides: Any) -> dict[str, Any]:
    event = {
        "type": "async_delegation",
        "delegation_id": "deleg_test",
        "parent_session_id": "sess-1",
        "goal": "do the thing",
        "status": "completed",
        "summary": "done",
        "results": [{"task_index": 0, "status": "completed", "summary": "done"}],
        "is_batch": True,
    }
    event.update(overrides)
    return event


@pytest.fixture(autouse=True)
def _no_hermes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep these tests independent of an installed Hermes source tree."""
    monkeypatch.setattr(completions, "_notification_text", lambda evt: "NOTIFICATION TEXT")
    monkeypatch.setattr(completions, "_display_text", lambda evt: "Subagent Tasks Completed: do the thing")
    monkeypatch.setattr(completions, "_durable_state", lambda delegation_id: "pending")


def test_display_metadata_counts_and_title() -> None:
    metadata = completions.display_metadata(
        _event(
            results=[
                {"task_index": 0, "status": "completed"},
                {"task_index": 1, "status": "error"},
            ],
            total_duration_seconds=12.5,
        )
    )
    assert metadata["delegation_id"] == "deleg_test"
    assert metadata["task_count"] == 2
    assert metadata["completed_count"] == 1
    assert metadata["failed_count"] == 1
    assert metadata["duration_seconds"] == 12.5
    assert metadata["display_text"] == "Subagent Tasks Completed: do the thing"
    assert "notification_category" not in metadata


def test_display_metadata_marks_failure_notices_diagnostic() -> None:
    metadata = completions.display_metadata(_event(task_failure_notice=True))
    assert metadata["notification_category"] == "diagnostic"


@pytest.mark.anyio
async def test_delivers_when_idle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    chat = FakeChat()
    consumer = _consumer(tmp_path, chat)
    calls: dict[str, Any] = {}
    monkeypatch.setattr(completions, "_claim", lambda evt: "claim-1")
    monkeypatch.setattr(completions, "_complete", lambda evt, claim: calls.update(completed=claim))
    monkeypatch.setattr(CompletionConsumer, "_requeue", staticmethod(lambda evt: calls.update(requeued=evt)))

    assert await consumer.deliver(_event()) is True

    assert calls["completed"] == "claim-1"
    assert "requeued" not in calls
    session_id, message, kwargs = chat.started[0]
    assert session_id == "sess-1"
    assert message == "NOTIFICATION TEXT"
    assert kwargs["display_kind"] == completions.DELIVERY_DISPLAY_KIND
    assert kwargs["display_metadata"]["display_text"].startswith("Subagent Tasks")


@pytest.mark.anyio
async def test_busy_session_requeues_without_spending_a_delivery_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chat = FakeChat(busy=True)
    consumer = _consumer(tmp_path, chat)

    def _must_not_claim(evt: dict[str, Any]) -> str:
        raise AssertionError("a busy session must not claim a completion")

    requeued: list[dict[str, Any]] = []
    monkeypatch.setattr(completions, "_claim", _must_not_claim)
    monkeypatch.setattr(CompletionConsumer, "_requeue", staticmethod(requeued.append))

    assert await consumer.deliver(_event()) is False
    assert requeued and requeued[0]["delegation_id"] == "deleg_test"
    assert chat.started is None


@pytest.mark.anyio
async def test_session_busy_race_defers_and_requeues(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    chat = FakeChat(failure=SessionBusy("a turn is already running for this session"))
    consumer = _consumer(tmp_path, chat)
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(completions, "_claim", lambda evt: "claim-2")
    monkeypatch.setattr(completions, "_defer", lambda delegation_id, claim: calls.append(("defer", claim)))
    monkeypatch.setattr(completions, "_release", lambda evt, claim: calls.append(("release", claim)))
    monkeypatch.setattr(CompletionConsumer, "_requeue", staticmethod(lambda evt: None))

    assert await consumer.deliver(_event()) is False
    assert calls == [("defer", "claim-2")]


@pytest.mark.anyio
async def test_unexpected_failure_spends_an_attempt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    chat = FakeChat(failure=ChatError("agent build failed"))
    consumer = _consumer(tmp_path, chat)
    calls: list[str] = []
    monkeypatch.setattr(completions, "_claim", lambda evt: "claim-3")
    monkeypatch.setattr(completions, "_defer", lambda delegation_id, claim: calls.append("defer"))
    monkeypatch.setattr(CompletionConsumer, "_requeue", staticmethod(lambda evt: None))

    assert await consumer.deliver(_event()) is False
    assert calls == ["defer"]

    chat.failure = RuntimeError("boom")
    monkeypatch.setattr(completions, "_release", lambda evt, claim: calls.append("release"))
    assert await consumer.deliver(_event()) is False
    assert calls == ["defer", "release"]


@pytest.mark.anyio
async def test_already_delivered_event_is_ignored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    chat = FakeChat()
    consumer = _consumer(tmp_path, chat)
    # claim_event_delivery returns None when the ledger row is no longer pending.
    monkeypatch.setattr(completions, "_claim", lambda evt: None)
    assert await consumer.deliver(_event()) is False
    assert chat.started is None


@pytest.mark.anyio
async def test_unknown_session_is_dropped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    chat = FakeChat()
    consumer = _consumer(tmp_path, chat, sessions=[])
    dropped: list[tuple[str, str]] = []
    monkeypatch.setattr(completions, "_claim", lambda evt: "claim-4")
    monkeypatch.setattr(completions, "_drop", lambda delegation_id, claim: dropped.append((delegation_id, claim)))

    assert await consumer.deliver(_event()) is False
    assert dropped == [("deleg_test", "claim-4")]
    assert chat.started is None


@pytest.mark.anyio
async def test_subagent_session_resolves_to_the_chat_that_can_show_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A nested delegation names the subagent's session; delivery belongs to the parent chat."""
    chat = FakeChat()
    consumer = _consumer(
        tmp_path,
        chat,
        sessions=[("parent-chat", "", ""), ("subagent-1", "subagent", "parent-chat")],
    )
    monkeypatch.setattr(completions, "_claim", lambda evt: "claim-5")
    monkeypatch.setattr(completions, "_complete", lambda evt, claim: None)

    assert await consumer.deliver(_event(parent_session_id="subagent-1")) is True
    assert chat.started[0][0] == "parent-chat"


def test_delivery_available_tracks_the_consumer() -> None:
    assert completions.delivery_available() is False
    completions._set_running(True)
    try:
        assert completions.delivery_available() is True
    finally:
        completions._set_running(False)
    assert completions.delivery_available() is False


@pytest.mark.anyio
async def test_completion_turn_marks_the_user_row_as_a_notice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The turn API carries the display kind the transcript needs, and refuses to steer."""
    import asyncio

    from astra.chat import ChatManager

    manager = ChatManager(SimpleNamespace(hermes_home=tmp_path))
    seen: list[Any] = []
    monkeypatch.setattr(manager, "_run_turn", lambda turn: seen.append(turn))
    try:
        await manager.start_completion_turn(
            "s1",
            "NOTICE TEXT",
            display_kind=completions.DELIVERY_DISPLAY_KIND,
            display_metadata={"delegation_id": "deleg_test"},
        )
        for _ in range(50):
            if seen:
                break
            await asyncio.sleep(0.01)
        assert seen, "the completion turn never reached the executor"
        turn = seen[0]
        assert turn.user_display_kind == completions.DELIVERY_DISPLAY_KIND
        assert turn.user_display_metadata == {"delegation_id": "deleg_test"}
        assert turn.operation == "notification"
        # A second completion must not interleave with a running turn.
        with pytest.raises(SessionBusy):
            await manager.start_completion_turn("s1", "ANOTHER")
    finally:
        # The turn never ran (its runner is stubbed), so release the shutdown wait.
        for turn in manager._turns.values():
            turn.done.set()
        await manager.close()


def test_session_context_binds_the_capability_honestly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Turns bind ``async_delivery`` from the consumer's real availability."""
    context = pytest.importorskip("gateway.session_context")
    from astra.chat import ChatManager, Turn

    manager = ChatManager(SimpleNamespace(hermes_home=tmp_path))
    turn = Turn(session_id="s1", message="hi", model=None, provider=None)
    monkeypatch.setattr(completions, "delivery_available", lambda: False)
    tokens = manager._bind_session_context(turn)
    try:
        assert context.async_delivery_supported() is False
        assert context.get_session_env("HERMES_SESSION_PLATFORM") == "webui"
        assert context.get_session_env("HERMES_SESSION_KEY") == "s1"
    finally:
        manager._clear_session_context(tokens)

"""Direct Hermes chat execution and SSE fan-out.

The ASGI loop only coordinates subscriptions.  Every blocking Hermes operation, including
provider resolution and ``AIAgent.run_conversation()``, runs in a bounded executor. Callbacks
from Hermes threads write to ``queue.SimpleQueue`` only; a single async pump fans events out to
all browser subscribers for that session.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio.to_thread
import yaml

from astra.config import Settings
from astra.hermes_bridge import agent_class, resolve_runtime_provider, session_db_class

log = logging.getLogger(__name__)


class ChatError(RuntimeError):
    pass


class SessionBusy(ChatError):
    pass


class NoActiveTurn(ChatError):
    pass


@dataclass(slots=True)
class ChatEvent:
    name: str
    data: dict[str, Any]


@dataclass(slots=True)
class PendingQuestion:
    id: int
    question: str
    choices: list[Any] | None
    response: str | None = None
    answered: threading.Event = field(default_factory=threading.Event)


@dataclass(slots=True)
class Turn:
    session_id: str
    message: str
    model: str | None
    provider: str | None
    events: queue.SimpleQueue[ChatEvent] = field(default_factory=queue.SimpleQueue)
    recent: list[ChatEvent] = field(default_factory=list)
    subscribers: set[asyncio.Queue[ChatEvent]] = field(default_factory=set)
    cancel: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    agent: Any = None
    question: PendingQuestion | None = None
    next_question_id: int = 1
    pump: asyncio.Task[None] | None = None


@dataclass(slots=True)
class CachedAgent:
    signature: str
    agent: Any
    session_db: Any


def _supported(callable_obj: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Keep upgrades compatible by passing only live accepted keywords."""
    try:
        parameters = inspect.signature(callable_obj).parameters
    except (TypeError, ValueError):
        return kwargs
    accepts_kwargs = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in parameters.values())
    return {key: value for key, value in kwargs.items() if key in parameters or accepts_kwargs}


def _load_chat_config(path: Path) -> dict[str, Any]:
    try:
        parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _webui_toolsets(config: dict[str, Any]) -> list[str] | None:
    """Honor a configured webui scope; None retains Hermes' normal default tool selection."""
    raw = config.get("platform_toolsets")
    if not isinstance(raw, dict):
        return None
    value = raw.get("webui")
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    return value


class ChatManager:
    def __init__(self, settings: Settings, *, max_workers: int = 4) -> None:
        self._settings = settings
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="astra-agent")
        self._turns: dict[str, Turn] = {}
        self._agents: dict[str, CachedAgent] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    async def close(self) -> None:
        self._closed = True
        async with self._lock:
            turns = list(self._turns.values())
        for turn in turns:
            self.stop_now(turn)
        self._executor.shutdown(wait=False, cancel_futures=False)
        for cached in self._agents.values():
            for closeable in (cached.agent, cached.session_db):
                try:
                    close = getattr(closeable, "close", None)
                    if callable(close):
                        close()
                except Exception:
                    log.debug("failed to close cached Hermes resource", exc_info=True)
        self._agents.clear()

    async def start(self, session_id: str, message: str, *, model: str | None, provider: str | None) -> None:
        if not message.strip():
            raise ChatError("message must not be empty")
        if self._closed:
            raise ChatError("chat service is shutting down")
        async with self._lock:
            if session_id in self._turns:
                raise SessionBusy("a turn is already running for this session")
            turn = Turn(session_id=session_id, message=message.strip(), model=model, provider=provider)
            self._turns[session_id] = turn
            turn.pump = asyncio.create_task(self._pump(turn), name=f"chat-pump-{session_id[:12]}")
        loop = asyncio.get_running_loop()
        loop.run_in_executor(self._executor, self._run_turn, turn)

    async def subscribe(self, session_id: str) -> asyncio.Queue[ChatEvent] | None:
        async with self._lock:
            turn = self._turns.get(session_id)
            if turn is None:
                return None
            subscriber: asyncio.Queue[ChatEvent] = asyncio.Queue(maxsize=128)
            # POST /send necessarily precedes the EventSource connection. Replay the small live
            # tail so a fast provider cannot lose its opening tokens in that hand-off window.
            for event in turn.recent:
                subscriber.put_nowait(event)
            turn.subscribers.add(subscriber)
            return subscriber

    async def unsubscribe(self, session_id: str, subscriber: asyncio.Queue[ChatEvent]) -> None:
        async with self._lock:
            turn = self._turns.get(session_id)
            if turn is not None:
                turn.subscribers.discard(subscriber)

    async def stop(self, session_id: str) -> bool:
        async with self._lock:
            turn = self._turns.get(session_id)
        if turn is None:
            return False
        self.stop_now(turn)
        return True

    def stop_now(self, turn: Turn) -> None:
        turn.cancel.set()
        with turn.lock:
            agent = turn.agent
        if agent is not None:
            try:
                hard_interrupt = getattr(agent, "hard_interrupt", None)
                if callable(hard_interrupt):
                    hard_interrupt(tool_reason="user_stop")
                else:
                    agent.interrupt(hard_cancel=True, tool_reason="user_stop")
            except Exception:
                log.debug("Hermes interrupt failed for session %s", turn.session_id, exc_info=True)
        with turn.lock:
            if turn.question is not None:
                turn.question.answered.set()

    async def steer(self, session_id: str, text: str) -> bool:
        async with self._lock:
            turn = self._turns.get(session_id)
        if turn is None:
            raise NoActiveTurn("no turn is running for this session")
        with turn.lock:
            agent = turn.agent
        if agent is None:
            raise ChatError("turn is starting; try again shortly")
        accepted = await anyio.to_thread.run_sync(agent.steer, text)
        if accepted:
            self._emit(turn, "steer", {"text": text, "accepted": True})
        return bool(accepted)

    async def answer(self, session_id: str, question_id: int, answer: str) -> bool:
        async with self._lock:
            turn = self._turns.get(session_id)
        if turn is None:
            raise NoActiveTurn("no turn is running for this session")
        with turn.lock:
            question = turn.question
            if question is None or question.id != question_id:
                return False
            question.response = answer
            question.answered.set()
        return True

    async def _pump(self, turn: Turn) -> None:
        """Drain the thread-only queue and fan out on the ASGI event loop."""
        while not turn.done.is_set() or not turn.events.empty():
            try:
                event = await anyio.to_thread.run_sync(turn.events.get, True, 0.25)
            except queue.Empty:
                continue
            turn.recent.append(event)
            if len(turn.recent) > 512:
                del turn.recent[: len(turn.recent) - 512]
            for subscriber in tuple(turn.subscribers):
                try:
                    subscriber.put_nowait(event)
                except asyncio.QueueFull:
                    # A reconnect fetches canonical history; never let one paused browser block a turn.
                    turn.subscribers.discard(subscriber)
        async with self._lock:
            self._turns.pop(turn.session_id, None)

    def _emit(self, turn: Turn, name: str, data: dict[str, Any]) -> None:
        turn.events.put(ChatEvent(name, data))

    def _build_agent(self, turn: Turn) -> Any:
        config = _load_chat_config(self._settings.paths.config_yaml)
        model_config = config.get("model") if isinstance(config.get("model"), dict) else {}
        model = turn.model or model_config.get("default")
        provider = turn.provider or model_config.get("provider")
        if not isinstance(model, str) or not model:
            raise ChatError("no Hermes model is configured")
        if not isinstance(provider, str) or not provider:
            provider = None
        runtime = resolve_runtime_provider()(requested=provider, target_model=model)
        toolsets = _webui_toolsets(config)
        key_sig = hashlib.sha256(str(runtime.get("api_key") or "").encode()).hexdigest()
        signature = json.dumps([model, runtime.get("provider"), runtime.get("base_url"), key_sig, toolsets], sort_keys=True)
        cached = self._agents.get(turn.session_id)
        if cached is not None and cached.signature == signature:
            agent = cached.agent
            clear_interrupt = getattr(agent, "clear_interrupt", None)
            if callable(clear_interrupt):
                clear_interrupt()
            agent.stream_delta_callback = lambda text: self._token_callback(turn, text)
            agent.reasoning_callback = lambda text: self._reasoning_callback(turn, text)
            agent.tool_progress_callback = lambda *args, **kwargs: self._tool_callback(turn, *args, **kwargs)
            agent.clarify_callback = lambda question, choices=None, *args: self._clarify_callback(turn, question, choices)
            return agent
        if cached is not None:
            try:
                cached.session_db.close()
            except Exception:
                pass
        session_db = session_db_class()(self._settings.paths.state_db)
        agent_kwargs = {
            "model": model,
            "provider": runtime.get("provider"),
            "base_url": runtime.get("base_url"),
            "api_key": runtime.get("api_key"),
            "api_mode": runtime.get("api_mode"),
            "platform": "webui",
            "quiet_mode": True,
            "enabled_toolsets": toolsets,
            "session_id": turn.session_id,
            "session_db": session_db,
            "stream_delta_callback": lambda text: self._token_callback(turn, text),
            "reasoning_callback": lambda text: self._reasoning_callback(turn, text),
            "tool_progress_callback": lambda *args, **kwargs: self._tool_callback(turn, *args, **kwargs),
            "clarify_callback": lambda question, choices=None, *args: self._clarify_callback(turn, question, choices),
            "gateway_session_key": turn.session_id,
        }
        agent = agent_class()(**_supported(agent_class().__init__, agent_kwargs))
        self._agents[turn.session_id] = CachedAgent(signature=signature, agent=agent, session_db=session_db)
        return agent

    def _run_turn(self, turn: Turn) -> None:
        try:
            agent = self._build_agent(turn)
            with turn.lock:
                turn.agent = agent
            history = turn.agent.session_db.get_messages_as_conversation(turn.session_id)
            run_kwargs = _supported(
                agent.run_conversation,
                {"user_message": turn.message, "conversation_history": history, "task_id": turn.session_id,
                 "persist_user_message": turn.message},
            )
            result = agent.run_conversation(**run_kwargs)
            if turn.cancel.is_set():
                self._emit(turn, "cancel", {"reason": "Cancelled by user"})
            else:
                self._emit(turn, "done", {"result": {"status": "completed", "has_result": bool(result)}})
        except Exception as exc:
            log.exception("chat turn failed for session %s", turn.session_id)
            self._emit(turn, "error", {"message": "The Hermes turn failed. Check server logs for details."})
        finally:
            turn.done.set()

    def _token_callback(self, turn: Turn, text: Any) -> None:
        if text:
            self._emit(turn, "delta", {"text": str(text)})

    def _reasoning_callback(self, turn: Turn, text: Any) -> None:
        if text:
            self._emit(turn, "reasoning", {"text": str(text)})

    def _tool_callback(self, turn: Turn, *args: Any, **kwargs: Any) -> None:
        # Hermes callback shape changes between releases; preserve only JSON-safe summaries.
        payload: dict[str, Any] = {"args": [str(item)[:4096] for item in args]}
        payload.update({key: str(value)[:4096] for key, value in kwargs.items()})
        self._emit(turn, "tool", payload)

    def _clarify_callback(self, turn: Turn, question: Any, choices: Any) -> str:
        with turn.lock:
            pending = PendingQuestion(turn.next_question_id, str(question), choices if isinstance(choices, list) else None)
            turn.next_question_id += 1
            turn.question = pending
        self._emit(turn, "clarify", {"id": pending.id, "question": pending.question, "choices": pending.choices})
        while not pending.answered.wait(0.25):
            if turn.cancel.is_set():
                return ""
        with turn.lock:
            if turn.question is pending:
                turn.question = None
        return pending.response or ""

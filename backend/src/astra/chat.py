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
import re
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio.to_thread
import yaml

from astra.config import Settings
from astra.hermes_bridge import (
    agent_class,
    approval_module,
    redact_approval_command,
    resolve_runtime_provider,
    session_db_class,
)

log = logging.getLogger(__name__)

# Live tok/s is a sliding-window instantaneous rate, not a since-start average: it should
# visibly speed up/slow down as generation does, not just settle toward one number.
_LIVE_TPS_WINDOW_SECONDS = 2.0
_EVENT_BATCH_SIZE = 128
_CODEX_AUTORAISE_NOTICE = re.compile(
    r"^ℹ Codex (?P<model>\S+) caps context at (?P<limit>\d+K), so "
    r"auto-compaction was raised to (?P<raised>\d+)% \(from (?P<previous>\d+)%\) "
    r"to use more of the window before summarizing\."
)


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
    seq: int = 0


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
    reasoning_effort: str | None = None
    events: queue.SimpleQueue[ChatEvent] = field(default_factory=queue.SimpleQueue)
    recent: list[ChatEvent] = field(default_factory=list)
    cancel: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    agent: Any = None
    # The session store this turn was built against, owned by Astra (see _build_agent).
    # Hermes' AIAgent does not expose the store it is handed, so this is the only
    # reference callers may rely on.
    session_db: Any = None
    question: PendingQuestion | None = None
    next_question_id: int = 1
    pump: asyncio.Task[None] | None = None
    accepting_steers: bool = True
    started_at: float = field(default_factory=time.monotonic)
    start_output_tokens: int = 0
    recent_delta_times: deque[float] = field(default_factory=lambda: deque(maxlen=64))
    operation: str = "chat"


@dataclass(slots=True)
class CachedAgent:
    session_id: str
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
    def __init__(self, settings: Settings, *, max_workers: int = 4, max_cached_agents: int = 16) -> None:
        self._settings = settings
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="astra-agent")
        self._turns: dict[str, Turn] = {}
        self._subscribers: dict[str, set[asyncio.Queue[ChatEvent]]] = {}
        self._event_seq: dict[str, int] = {}
        self._seq_lock = threading.Lock()
        self._agents: OrderedDict[str, CachedAgent] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._max_cached_agents = max_cached_agents
        self._lock = asyncio.Lock()
        self._closed = False
        self._compression_recovery: set[str] = set()

    async def close(self) -> None:
        self._closed = True
        async with self._lock:
            turns = list(self._turns.values())
        for turn in turns:
            self.stop_now(turn)
        if turns:
            await asyncio.gather(
                *(anyio.to_thread.run_sync(turn.done.wait, 10.0) for turn in turns),
                return_exceptions=True,
            )
        # Memory extraction is a blocking Hermes operation. Keep it off the event loop, but
        # wait during orderly shutdown so the durable session boundary is not silently lost.
        with self._cache_lock:
            cached_agents = list(self._agents.values())
            self._agents.clear()
        loop = asyncio.get_running_loop()
        await asyncio.gather(
            *(loop.run_in_executor(self._executor, self._commit_and_close, cached) for cached in cached_agents),
            return_exceptions=True,
        )
        self._executor.shutdown(wait=False, cancel_futures=False)

    async def is_running(self, session_id: str) -> bool:
        async with self._lock:
            return session_id in self._turns

    def recovery_available(self, session_id: str) -> bool:
        return session_id in self._compression_recovery

    def consume_recovery(self, session_id: str) -> bool:
        if session_id not in self._compression_recovery:
            return False
        self._compression_recovery.discard(session_id)
        return True

    async def commit_idle(self) -> None:
        """Commit and evict cached agents that are not executing a turn.

        Session creation schedules this coroutine as background work. Removing entries before
        dispatch makes concurrent starts build a fresh agent instead of racing the boundary.
        """
        async with self._lock:
            active = set(self._turns)
        with self._cache_lock:
            idle = [cached for key, cached in self._agents.items() if key not in active]
            for cached in idle:
                self._agents.pop(cached.session_id, None)
        if not idle:
            return
        loop = asyncio.get_running_loop()
        await asyncio.gather(
            *(loop.run_in_executor(self._executor, self._commit_and_close, cached) for cached in idle),
            return_exceptions=True,
        )

    async def start(
        self,
        session_id: str,
        message: str,
        *,
        model: str | None,
        provider: str | None,
        reasoning_effort: str | None = None,
    ) -> None:
        if not message.strip():
            raise ChatError("message must not be empty")
        if self._closed:
            raise ChatError("chat service is shutting down")
        self._compression_recovery.discard(session_id)
        async with self._lock:
            if session_id in self._turns:
                raise SessionBusy("a turn is already running for this session")
            turn = Turn(
                session_id=session_id,
                message=message.strip(),
                model=model,
                provider=provider,
                reasoning_effort=reasoning_effort,
            )
            self._turns[session_id] = turn
            turn.pump = asyncio.create_task(self._pump(turn), name=f"chat-pump-{session_id[:12]}")
            self._emit(turn, "started", {"running": True, "operation": "chat"})
        loop = asyncio.get_running_loop()
        loop.run_in_executor(self._executor, self._run_turn, turn)

    async def start_compaction(
        self,
        session_id: str,
        focus_topic: str | None,
        *,
        model: str | None,
        provider: str | None,
    ) -> None:
        """Run an explicit in-place Hermes context compaction as a streamed job."""
        if self._closed:
            raise ChatError("chat service is shutting down")
        async with self._lock:
            if session_id in self._turns:
                raise SessionBusy("a turn is already running for this session")
            turn = Turn(
                session_id=session_id,
                message=(focus_topic or "").strip(),
                model=model,
                provider=provider,
                operation="compact",
            )
            self._turns[session_id] = turn
            turn.pump = asyncio.create_task(self._pump(turn), name=f"chat-pump-{session_id[:12]}")
            self._emit(turn, "started", {"running": True, "operation": "compact"})
        asyncio.get_running_loop().run_in_executor(self._executor, self._run_compaction, turn)

    async def start_after_prepare(
        self,
        session_id: str,
        prepare: Callable[[], str],
        *,
        model: str | None,
        provider: str | None,
        reasoning_effort: str | None = None,
    ) -> None:
        """Reserve a session, mutate its transcript, then start the replacement turn.

        Holding the service lock across ``prepare`` prevents another browser request from
        starting a turn in the small gap between a regenerate rewind and its replacement.
        Hermes' write-side lease checks still protect against other processes.
        """
        if self._closed:
            raise ChatError("chat service is shutting down")
        async with self._lock:
            if session_id in self._turns:
                raise SessionBusy("a turn is already running for this session")
            loop = asyncio.get_running_loop()
            message = (await loop.run_in_executor(self._executor, prepare)).strip()
            if not message:
                raise ChatError("message must not be empty")
            turn = Turn(
                session_id=session_id,
                message=message,
                model=model,
                provider=provider,
                reasoning_effort=reasoning_effort,
            )
            self._turns[session_id] = turn
            turn.pump = asyncio.create_task(self._pump(turn), name=f"chat-pump-{session_id[:12]}")
            self._emit(turn, "started", {"running": True, "operation": "regenerate"})
        loop.run_in_executor(self._executor, self._run_turn, turn)

    async def subscribe(self, session_id: str, *, after_seq: int = 0) -> tuple[asyncio.Queue[ChatEvent], bool]:
        async with self._lock:
            turn = self._turns.get(session_id)
            # The active turn's replay is intentionally complete: canonical assistant history
            # is not guaranteed to be persisted until completion, so truncating this buffer
            # would create a gap when a browser is reopened mid-turn. It is released with the
            # Turn and therefore remains bounded by the provider's per-turn output limit.
            subscriber: asyncio.Queue[ChatEvent] = asyncio.Queue(maxsize=max(1024, len(turn.recent) + 512) if turn else 1024)
            # POST /send necessarily precedes the EventSource connection. Replay the complete
            # active turn so opening on another device cannot leave a token gap.
            if turn is not None:
                for event in turn.recent:
                    if event.seq > after_seq:
                        subscriber.put_nowait(event)
            self._subscribers.setdefault(session_id, set()).add(subscriber)
            return subscriber, turn is not None

    async def unsubscribe(self, session_id: str, subscriber: asyncio.Queue[ChatEvent]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(session_id)
            if subscribers is not None:
                subscribers.discard(subscriber)
                if not subscribers:
                    self._subscribers.pop(session_id, None)

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
            if not turn.accepting_steers:
                raise NoActiveTurn("the turn completed before the steer could be applied")
            # steer() only stores a short string under Hermes' own lock. Keeping the turn lock
            # across it makes completion+drain atomic with respect to this acceptance decision.
            accepted = agent.steer(text)
        if accepted:
            self._emit(turn, "steer", {"text": text, "accepted": True})
        return bool(accepted)

    async def approve(self, session_id: str, request_id: str, choice: str, reason: str | None) -> bool:
        async with self._lock:
            turn = self._turns.get(session_id)
        if turn is None:
            raise NoActiveTurn("no turn is running for this session")
        resolved = await anyio.to_thread.run_sync(
            lambda: approval_module().resolve_gateway_approval(
                session_id, choice, reason=reason, request_id=request_id
            )
        )
        if resolved:
            self._emit(turn, "approval_resolved", {"request_id": request_id, "choice": choice})
        return bool(resolved)

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

    @staticmethod
    def _drain_events(turn: Turn) -> list[ChatEvent]:
        # Wait only for the first event. Drain an available burst without adding latency to
        # individual tokens, and bound each batch so subscribers and other turns get to run.
        batch = [turn.events.get(True, 0.25)]
        for _ in range(_EVENT_BATCH_SIZE - 1):
            try:
                batch.append(turn.events.get_nowait())
            except queue.Empty:
                break
        return batch

    async def _pump(self, turn: Turn) -> None:
        """Drain the thread-only queue and fan out on the ASGI event loop."""
        while not turn.done.is_set() or not turn.events.empty():
            try:
                batch = await anyio.to_thread.run_sync(self._drain_events, turn)
            except queue.Empty:
                continue
            async with self._lock:
                # Publish replay and live delivery atomically with respect to subscribe().
                turn.recent.extend(batch)
                subscribers = tuple(self._subscribers.get(turn.session_id, ()))
                for subscriber in subscribers:
                    for event in batch:
                        try:
                            subscriber.put_nowait(event)
                        except asyncio.QueueFull:
                            # A paused browser must never block a turn.
                            self._subscribers.get(turn.session_id, set()).discard(subscriber)
                            break
        async with self._lock:
            self._turns.pop(turn.session_id, None)

    def _emit(self, turn: Turn, name: str, data: dict[str, Any]) -> None:
        with self._seq_lock:
            seq = self._event_seq.get(turn.session_id, 0) + 1
            self._event_seq[turn.session_id] = seq
        turn.events.put(ChatEvent(name, data, seq))

    def _wire_agent_callbacks(self, agent: Any, turn: Turn) -> None:
        callbacks = {
            "stream_delta_callback": lambda text: self._token_callback(turn, text),
            "reasoning_callback": lambda text: self._reasoning_callback(turn, text),
            "tool_progress_callback": lambda *args, **kwargs: self._tool_callback(turn, *args, **kwargs),
            "clarify_callback": lambda question, choices=None, *args: self._clarify_callback(turn, question, choices),
            "event_callback": lambda name, data=None: self._agent_event_callback(turn, name, data),
            "status_callback": lambda status, *args, **kwargs: self._status_callback(turn, status, *args),
        }
        for name, callback in callbacks.items():
            if hasattr(agent, name):
                setattr(agent, name, callback)

    def _register_approvals(self, turn: Turn) -> None:
        def notify(data: Any) -> None:
            raw = data if isinstance(data, dict) else {"description": str(data)}
            # Explicit allowlist: approval payloads can grow internal fields across Hermes
            # releases and must never accidentally expose credentials or environment details.
            safe = {
                key: raw[key]
                for key in ("request_id", "description", "pattern_keys")
                if key in raw
            }
            if "command" in raw:
                command = redact_approval_command(raw["command"])
                if command is not None:
                    safe["command"] = command
            self._emit(turn, "approval", safe)

        approvals = approval_module()
        approvals.register_gateway_notify(turn.session_id, notify)
        pending = approvals.get_pending_gateway_approval(turn.session_id)
        if pending:
            notify(pending)

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
        reasoning_config = None
        if turn.reasoning_effort == "none":
            reasoning_config = {"enabled": False}
        elif turn.reasoning_effort:
            reasoning_config = {"enabled": True, "effort": turn.reasoning_effort}
        signature = json.dumps(
            [model, runtime.get("provider"), runtime.get("base_url"), key_sig, toolsets, reasoning_config],
            sort_keys=True,
        )
        with self._cache_lock:
            cached = self._agents.get(turn.session_id)
        if cached is not None and cached.signature == signature:
            agent = cached.agent
            clear_interrupt = getattr(agent, "clear_interrupt", None)
            if callable(clear_interrupt):
                clear_interrupt()
            self._wire_agent_callbacks(agent, turn)
            with self._cache_lock:
                self._agents.move_to_end(turn.session_id)
            turn.session_db = cached.session_db
            return agent
        if cached is not None:
            self._commit_and_close(cached)
        session_db = session_db_class()(self._settings.paths.state_db)
        agent_kwargs = {
            "model": model,
            "provider": runtime.get("provider"),
            "base_url": runtime.get("base_url"),
            "api_key": runtime.get("api_key"),
            "api_mode": runtime.get("api_mode"),
            # Hermes owns opening-turn auto-titling in its shared turn prologue. Identifying
            # Astra as a human-facing webui surface enables that canonical, one-time path;
            # Astra intentionally does not add periodic/adaptive re-titling model calls.
            "platform": "webui",
            "quiet_mode": True,
            "enabled_toolsets": toolsets,
            "reasoning_config": reasoning_config,
            "session_id": turn.session_id,
            "session_db": session_db,
            "stream_delta_callback": lambda text: self._token_callback(turn, text),
            "reasoning_callback": lambda text: self._reasoning_callback(turn, text),
            "tool_progress_callback": lambda *args, **kwargs: self._tool_callback(turn, *args, **kwargs),
            "clarify_callback": lambda question, choices=None, *args: self._clarify_callback(turn, question, choices),
            "gateway_session_key": turn.session_id,
        }
        agent = agent_class()(**_supported(agent_class().__init__, agent_kwargs))
        self._wire_agent_callbacks(agent, turn)
        evicted: CachedAgent | None = None
        with self._cache_lock:
            self._agents[turn.session_id] = CachedAgent(
                session_id=turn.session_id, signature=signature, agent=agent, session_db=session_db
            )
            self._agents.move_to_end(turn.session_id)
            if len(self._agents) > self._max_cached_agents:
                _, evicted = self._agents.popitem(last=False)
        if evicted is not None:
            self._commit_and_close(evicted)
        turn.session_db = session_db
        return agent

    def _run_turn(self, turn: Turn) -> None:
        try:
            agent = self._build_agent(turn)
            with turn.lock:
                turn.agent = agent
            turn.start_output_tokens = getattr(agent, "session_completion_tokens", 0) or 0
            self._register_approvals(turn)
            history = turn.session_db.get_messages_as_conversation(turn.session_id)
            run_kwargs = _supported(
                agent.run_conversation,
                {"user_message": turn.message, "conversation_history": history, "task_id": turn.session_id,
                 "persist_user_message": turn.message},
            )
            result = agent.run_conversation(**run_kwargs)
            with turn.lock:
                turn.accepting_steers = False
                late_steer = self._drain_late_steer(agent)
            usage = self._final_usage(turn)
            if self._is_compression_exhausted(result):
                self._compression_recovery.add(turn.session_id)
                self._emit(turn, "error", {
                    "message": "The conversation is too large to compress safely in place.",
                    "error_type": "compression_exhausted",
                    "recovery_available": True,
                })
            elif turn.cancel.is_set():
                self._emit(turn, "cancel", {"reason": "Cancelled by user", "late_steer": late_steer, **usage})
            elif (failure := self._returned_failure(result)) is not None:
                # Hermes reports provider failures (billing, auth, lease timeouts) as a returned
                # result, not an exception, and does not persist the text. Without this the turn
                # looks completed and the browser shows nothing.
                self._emit(turn, "error", {**failure, "late_steer": late_steer, **usage})
            else:
                self._emit(turn, "done", {"result": {"status": "completed", "has_result": bool(result)}, "late_steer": late_steer, **usage})
        except Exception as exc:
            log.exception("chat turn failed for session %s", turn.session_id)
            if self._is_compression_exhausted(exc):
                self._compression_recovery.add(turn.session_id)
                self._emit(turn, "error", {
                    "message": "The conversation is too large to compress safely in place.",
                    "error_type": "compression_exhausted",
                    "recovery_available": True,
                })
            else:
                self._emit(turn, "error", {"message": "The Hermes turn failed. Check server logs for details."})
        finally:
            with turn.lock:
                turn.accepting_steers = False
            try:
                approval_module().unregister_gateway_notify(turn.session_id)
            except Exception:
                log.debug("failed to unregister approval bridge", exc_info=True)
            turn.done.set()

    def _run_compaction(self, turn: Turn) -> None:
        db: Any = None
        lock_holder: str | None = None
        try:
            agent = self._build_agent(turn)
            with turn.lock:
                turn.agent = agent
            self._emit(turn, "status", {
                "kind": "compacting",
                "message": "Compacting context — summarizing earlier conversation…",
            })
            db = turn.session_db
            if db is None:
                raise ChatError("No Hermes session store is attached to this turn for compaction.")
            acquire_lock = getattr(db, "try_acquire_compression_lock", None)
            if callable(acquire_lock):
                lock_holder = f"astra:{threading.get_ident()}:{time.monotonic_ns()}"
                if not acquire_lock(turn.session_id, lock_holder):
                    lock_holder = None
                    raise ChatError("Context compression is already running for this conversation.")
            history = db.get_messages_as_conversation(turn.session_id)
            if len(history) < 4:
                raise ChatError("Not enough conversation to compact yet (at least 4 messages are required).")
            watermark_fn = getattr(db, "get_active_message_watermark", None)
            watermark = watermark_fn(turn.session_id) if callable(watermark_fn) else None
            compressed = agent.context_compressor.compress(
                history,
                focus_topic=turn.message or None,
                force=True,
            )
            if turn.cancel.is_set():
                self._emit(turn, "cancel", {"reason": "Compaction cancelled by user"})
                return
            if compressed == history:
                raise ChatError("This conversation could not be compacted further.")
            # Hermes tags the verbatim tail so its originals can be archived as superseded
            # duplicates instead of summarized-away history. The orchestration layer normally
            # consumes this private marker; manual compaction owns that responsibility here.
            tail_count = 0
            for message in compressed:
                if isinstance(message, dict) and message.pop("_compaction_tail", None):
                    tail_count += 1
            archive = getattr(db, "archive_and_compact", None)
            if callable(archive):
                archive(
                    turn.session_id,
                    compressed,
                    **_supported(archive, {
                        "watermark": watermark,
                        "tail_count": tail_count,
                        "lock_holder": lock_holder,
                    }),
                )
            else:
                # Compatibility with older Hermes releases. This loses the archived display
                # prefix, but retains a valid live model context rather than failing /compact.
                db.replace_messages(turn.session_id, compressed)
            self._compression_recovery.discard(turn.session_id)
            payload = {
                "phase": "done",
                "before_messages": len(history),
                "after_messages": len(compressed),
                "focus_topic": turn.message or None,
            }
            self._emit(turn, "compaction", payload)
            self._emit(turn, "done", {"result": {"status": "compacted"}, **payload})
        except ChatError as exc:
            self._emit(turn, "error", {"message": str(exc), "error_type": "compaction_failed"})
        except Exception:
            log.exception("manual compaction failed for session %s", turn.session_id)
            self._emit(turn, "error", {
                "message": "Context compaction failed. Check server logs for details.",
                "error_type": "compaction_failed",
            })
        finally:
            if db is not None and lock_holder is not None:
                release_lock = getattr(db, "release_compression_lock", None)
                if callable(release_lock):
                    try:
                        release_lock(turn.session_id, lock_holder)
                    except Exception:
                        log.debug("failed to release manual compression lock", exc_info=True)
            with turn.lock:
                turn.accepting_steers = False
            turn.done.set()

    @staticmethod
    def _is_compression_exhausted(value: Any) -> bool:
        if isinstance(value, dict) and value.get("compression_exhausted"):
            return True
        text = str(value).lower()
        return (
            "compression_exhausted" in text
            or "compression exhausted" in text
            or ("context length exceeded" in text and "cannot compress further" in text)
            or ("context compression" in text and "max compression attempts" in text)
        )

    @staticmethod
    def _returned_failure(result: Any) -> dict[str, Any] | None:
        if not isinstance(result, dict) or not (result.get("failed") or result.get("interrupted")):
            return None
        message = result.get("final_response") or result.get("error")
        message = str(message).strip() if message else ""
        return {
            "message": message[:4000] or "The Hermes turn failed. Check server logs for details.",
            "error_type": str(result.get("failure_reason") or ("interrupted" if result.get("interrupted") else "turn_failed")),
        }

    @staticmethod
    def _drain_late_steer(agent: Any) -> str | None:
        drain = getattr(agent, "_drain_pending_steer", None)
        if not callable(drain):
            return None
        value = drain()
        return str(value) if value else None

    @staticmethod
    def _commit_and_close(cached: CachedAgent) -> None:
        try:
            commit = getattr(cached.agent, "commit_memory_session", None)
            if callable(commit):
                history = cached.session_db.get_messages_as_conversation(cached.session_id)
                commit(history)
        except Exception:
            log.warning("Hermes memory commit failed at session boundary", exc_info=True)
        finally:
            for closeable in (cached.agent, cached.session_db):
                try:
                    close = getattr(closeable, "close", None)
                    if callable(close):
                        close()
                except Exception:
                    log.debug("failed to close cached Hermes resource", exc_info=True)

    def _token_callback(self, turn: Turn, text: Any) -> None:
        if not text:
            return
        now = time.monotonic()
        window = turn.recent_delta_times
        window.append(now)
        while window and now - window[0] > _LIVE_TPS_WINDOW_SECONDS:
            window.popleft()
        payload: dict[str, Any] = {"text": str(text)}
        if len(window) >= 2:
            span = window[-1] - window[0]
            if span > 0.1:
                payload["tps"] = round((len(window) - 1) / span, 1)
        self._emit(turn, "delta", payload)

    @staticmethod
    def _final_usage(turn: Turn) -> dict[str, Any]:
        agent = turn.agent
        output_tokens = max(0, (getattr(agent, "session_completion_tokens", 0) or 0) - turn.start_output_tokens)
        duration = time.monotonic() - turn.started_at
        if output_tokens <= 0 or duration <= 0:
            return {}
        return {"output_tokens": output_tokens, "tps": round(output_tokens / duration, 1)}

    def _reasoning_callback(self, turn: Turn, text: Any) -> None:
        if text:
            self._emit(turn, "reasoning", {"text": str(text)})

    def _status_callback(self, turn: Turn, status: Any, *args: Any) -> None:
        status_text = str(status)
        message = " ".join(str(item) for item in args if item is not None).strip() or status_text
        # Hermes sends its one-time configuration notice as a lifecycle status. It says the
        # model "caps context" even though this is Hermes's selected Codex limit, and its
        # mention of auto-compaction must not be reported as compaction in progress.
        if status_text == "lifecycle" and (notice := _CODEX_AUTORAISE_NOTICE.match(message)):
            message = _CODEX_AUTORAISE_NOTICE.sub(
                f"ℹ Hermes is using a {notice['limit']} context limit for this Codex "
                f"{notice['model']} session. Its auto-compaction threshold is "
                f"{notice['raised']}% (instead of {notice['previous']}%).",
                message,
                count=1,
            )
            self._emit(turn, "status", {"kind": "status", "message": message[:1200]})
            return
        lowered = f"{status_text} {message}".lower()
        kind = "status"
        if status_text == "compacted" or "compaction complete" in lowered:
            kind = "compacted"
        elif "compact" in lowered or "compress" in lowered:
            kind = "compacting"
        self._emit(turn, "status", {"kind": kind, "message": message[:1200]})

    def _tool_callback(self, turn: Turn, *args: Any, **kwargs: Any) -> None:
        # Hermes callback shape changes between releases; preserve only JSON-safe summaries.
        payload: dict[str, Any] = {"args": [str(item)[:4096] for item in args]}
        payload.update({key: str(value)[:4096] for key, value in kwargs.items()})
        self._emit(turn, "tool", payload)

    def _agent_event_callback(self, turn: Turn, name: Any, data: Any) -> None:
        event_name = str(name)
        if event_name == "session:compress":
            raw = data if isinstance(data, dict) else {}
            self._emit(turn, "compaction", {
                "phase": "done",
                "in_place": bool(raw.get("in_place")),
                "compression_count": raw.get("compression_count"),
            })
            return
        if event_name.startswith(("subagent", "delegate")):
            payload = data if isinstance(data, dict) else {"message": str(data)}
            self._emit(turn, "subagent", {key: str(value)[:4096] for key, value in payload.items()})

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

"""Deliver detached subagent results into chats.

Hermes runs every top-level ``delegate_task`` in the **background**: the tool call returns a
handle and the result arrives later as a ``type="async_delegation"`` event on the process-global
``tools.process_registry`` completion queue.  Some surface has to drain that queue — the gateway
has ``_async_delegation_watcher`` and the TUI has its notification poller.  This process had no
consumer at all, so on the WebUI every subagent finished into the void: the durable ledger row in
``state.db`` stayed ``delivery_state='pending'`` with ``delivery_attempts=0`` forever and the
parent conversation was never told (the parent had already ended its turn believing the result
would "re-enter the conversation").

This module is that consumer.  Delivery is a **real turn**, the same shape the TUI uses: the
completion text is the user message, persisted with
``display_kind="async_delegation_complete"`` so the transcript paints a compact notice instead of
a wall of notification text, and the agent continues with the result in context — which is what
makes it act on a subagent's output instead of waiting to be asked.

Failure handling is deliberately fail-soft and non-lossy:

* session busy (its own turn still running) → the event goes back on the queue, no delivery
  attempt is spent, and the next tick retries.  The parent turn ending is all the signal needed.
* unknown target session → claimed and terminally dropped with a log line, so the row cannot sit
  pending forever.
* delivery raised something other than "busy" → the durable claim is released (spending one of
  Hermes' bounded attempts) and the event is retried, converging to ``dropped`` instead of looping.

The consumer also publishes ``delivery_available()``: ``chat`` binds each turn's session context
with ``async_delivery=delivery_available()``, so a process whose consumer is not running falls
back to Hermes' synchronous delegation (results returned in the tool call) rather than detaching
into a queue nobody drains.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from astra.chat import ChatError, ChatManager, SessionBusy
from astra.deps import AppContext, ProfileContexts

log = logging.getLogger(__name__)

#: Personality of the persisted user row for a completion. Hermes' own surfaces use this exact
#: kind; the transcript renders metadata.display_text instead of the full model notification.
DELIVERY_DISPLAY_KIND = "async_delegation_complete"

#: How often the queue is polled.  Completions are user-visible events, so keep it snappy; the
#: drain is a handful of dicts on an idle queue.
POLL_INTERVAL_S = 1.0

#: Give the app a moment to finish starting (and Hermes' process registry to replay its durable
#: pending rows) before the first drain.
STARTUP_DELAY_S = 3.0

#: Bounded walk up from a subagent session to the chat that can actually show a result.
_MAX_ANCESTOR_HOPS = 4

_state_lock = threading.Lock()
_running = False


def delivery_available() -> bool:
    """Whether a completion consumer is live in this process.

    ``False`` makes Hermes run delegations synchronously in-turn, which is correct-but-blocking;
    it is the safe direction to fail in when nobody would deliver the result.
    """
    with _state_lock:
        return _running


def _set_running(value: bool) -> None:
    global _running
    with _state_lock:
        _running = value


# ── Hermes glue (thin wrappers so the orchestration below is testable without Hermes) ──


def _pop_delegations() -> list[dict[str, Any]]:
    """Take every ``async_delegation`` event off the process completion queue, leaving the rest.

    Other event types (process completions, watch matches) belong to whoever else drains them;
    they are put back untouched in their original order.
    """
    from tools.process_registry import process_registry

    queue = process_registry.completion_queue
    mine: list[dict[str, Any]] = []
    others: list[Any] = []
    while True:
        try:
            evt = queue.get_nowait()
        except Exception:  # queue.Empty, plus any exotic queue failure
            break
        if isinstance(evt, dict) and evt.get("type") == "async_delegation":
            mine.append(evt)
        else:
            others.append(evt)
    for evt in others:
        queue.put(evt)
    return mine


def _claim(evt: dict[str, Any]) -> str | None:
    from tools.async_delegation import claim_event_delivery

    return claim_event_delivery(evt, "astra")


def _complete(evt: dict[str, Any], claim: str) -> None:
    from tools.async_delegation import complete_event_delivery

    complete_event_delivery(evt, claim)


def _defer(delegation_id: str, claim: str) -> None:
    """Hand a claimed completion back without spending a delivery attempt."""
    from tools.async_delegation import defer_completion_delivery

    defer_completion_delivery(delegation_id, claim)


def _release(evt: dict[str, Any], claim: str) -> None:
    """Hand a claimed completion back *and* spend an attempt (bounded retries)."""
    from tools.async_delegation import release_event_delivery

    release_event_delivery(evt, claim)


def _drop(delegation_id: str, claim: str) -> None:
    from tools.async_delegation import drop_completion_delivery

    drop_completion_delivery(delegation_id, claim)


def _notification_text(evt: dict[str, Any]) -> str | None:
    """The model-facing notification text (full task source, status, result)."""
    from tools.process_registry_notifications import format_process_notification

    note = format_process_notification(evt)
    return str(note) if note else None


def _display_text(evt: dict[str, Any]) -> str:
    from tools.process_registry_notifications import async_delegation_display_text

    return async_delegation_display_text(evt)


def _durable_state(delegation_id: str) -> str | None:
    from tools.async_delegation import get_durable_delegation

    record = get_durable_delegation(delegation_id)
    return None if record is None else str(record.get("delivery_state") or "")


def display_metadata(evt: dict[str, Any]) -> dict[str, Any]:
    """Display-only metadata for the persisted row.

    Mirrors ``gateway.wake._delegation_display_metadata`` (that module drags in the whole gateway
    stack) and adds ``display_text``, the compact title the transcript paints.
    """
    raw_results = evt.get("results")
    results = [r for r in raw_results if isinstance(r, dict)] if isinstance(raw_results, list) else []
    task_count = len(results) or 1
    failed_count = sum(1 for r in results if r.get("status") in {"failed", "error"})
    metadata: dict[str, Any] = {
        "delegation_id": str(evt.get("delegation_id") or ""),
        "task_count": task_count,
        "completed_count": sum(1 for r in results if r.get("status") in {"completed", "success"}),
        "failed_count": failed_count,
        "display_text": _display_text(evt),
    }
    if evt.get("task_failure_notice"):
        metadata["notification_category"] = "diagnostic"
    duration = evt.get("total_duration_seconds") or evt.get("duration_seconds")
    if isinstance(duration, (int, float)):
        metadata["duration_seconds"] = duration
    return metadata


# ── Target resolution ──


def _claims_session(db_path: Path, session_id: str) -> dict[str, Any] | None:
    """``{id, source, parent_session_id}`` when ``session_id`` lives in this state.db."""
    if not session_id or not db_path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute(
            "SELECT id, source, parent_session_id FROM sessions WHERE id = ? LIMIT 1", (session_id,)
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    if row is None:
        return None
    return {"id": row[0], "source": row[1] or "", "parent_session_id": row[2] or ""}


class CompletionConsumer:
    """Drains Hermes' async-delegation completions into the chat that dispatched them."""

    def __init__(
        self,
        base: AppContext,
        contexts: ProfileContexts,
        *,
        interval: float = POLL_INTERVAL_S,
        startup_delay: float = STARTUP_DELAY_S,
    ) -> None:
        self._base = base
        self._contexts = contexts
        self._interval = interval
        self._startup_delay = startup_delay

    # -- lifecycle ---------------------------------------------------------------

    async def run(self) -> None:
        await asyncio.sleep(self._startup_delay)
        _set_running(True)
        log.info("subagent completion consumer started")
        try:
            while True:
                try:
                    await self.drain_once()
                except asyncio.CancelledError:
                    raise
                except Exception:  # a broken drain must never kill the loop
                    log.exception("subagent completion drain failed")
                await asyncio.sleep(self._interval)
        finally:
            _set_running(False)
            log.info("subagent completion consumer stopped")

    # -- one pass ----------------------------------------------------------------

    async def drain_once(self) -> int:
        """Deliver every queued completion that can be delivered now; returns how many went out."""
        events = await asyncio.to_thread(_pop_delegations)
        delivered = 0
        for evt in events:
            if await self.deliver(evt):
                delivered += 1
        return delivered

    async def deliver(self, evt: dict[str, Any]) -> bool:
        """Route one completion event.  ``False`` means it was put back for a later tick."""
        delegation_id = str(evt.get("delegation_id") or "")
        if not delegation_id:
            log.warning("async delegation event without a delegation id dropped")
            return False

        chat, session_id = await asyncio.to_thread(self._resolve, evt)
        if chat is None or not session_id:
            # Nobody in this process can show it: settle the row instead of leaving it pending.
            claim = await asyncio.to_thread(_claim, evt)
            if claim is not None:
                await asyncio.to_thread(_drop, delegation_id, claim)
            log.warning(
                "no local chat matches async delegation %s (parent=%s); result not delivered",
                delegation_id, evt.get("parent_session_id"),
            )
            return False

        if await chat.is_running(session_id):
            # The dispatching turn is still working.  No claim, no attempt spent: retry when idle.
            self._requeue(evt)
            log.debug("async delegation %s waiting for session %s to go idle", delegation_id, session_id)
            return False

        claim = await asyncio.to_thread(_claim, evt)
        if claim is None:
            # Already delivered, or claimed by another consumer (durable replay, second process).
            return False
        if await asyncio.to_thread(_durable_state, delegation_id) == "delivered":
            return False

        text = await asyncio.to_thread(_notification_text, evt)
        if not text:
            await asyncio.to_thread(_complete, evt, claim)
            return False

        metadata = display_metadata(evt)
        try:
            await chat.start_completion_turn(
                session_id, text, display_kind=DELIVERY_DISPLAY_KIND, display_metadata=metadata
            )
        except SessionBusy:
            await asyncio.to_thread(_defer, delegation_id, claim)
            self._requeue(evt)
            return False
        except ChatError as exc:
            await asyncio.to_thread(_defer, delegation_id, claim)
            self._requeue(evt)
            log.warning("async delegation %s could not start a turn (%s); retrying", delegation_id, exc)
            return False
        except Exception:
            await asyncio.to_thread(_release, evt, claim)
            self._requeue(evt)
            log.exception("async delegation %s delivery failed; retrying", delegation_id)
            return False

        await asyncio.to_thread(_complete, evt, claim)
        log.info(
            "async delegation %s delivered to session %s (%s)",
            delegation_id, session_id, metadata.get("display_text", ""),
        )
        return True

    # -- helpers -----------------------------------------------------------------

    @staticmethod
    def _requeue(evt: dict[str, Any]) -> None:
        try:
            from tools.process_registry import process_registry

            process_registry.completion_queue.put(evt)
        except Exception:  # pragma: no cover - queue import failure means nothing can drain
            log.exception("could not requeue async delegation event")

    def _resolve(self, evt: dict[str, Any]) -> tuple[ChatManager | None, str]:
        """Find the chat that should receive this completion.

        The dispatcher's own session id is authoritative; older events may only carry a routing
        key.  A subagent's own session id resolves up to the nearest conversation that can show
        a message.
        """
        for key in ("parent_session_id", "origin_ui_session_id", "origin_session_id", "session_key"):
            session_id = str(evt.get(key) or "").strip()
            if not session_id:
                continue
            for _ in range(_MAX_ANCESTOR_HOPS):
                chat, db_path = self._find(session_id)
                if chat is None or db_path is None:
                    break
                row = _claims_session(db_path, session_id)
                if row is None or row["source"] != "subagent" or not row["parent_session_id"]:
                    return chat, session_id
                session_id = row["parent_session_id"]
        return None, ""

    def _find(self, session_id: str) -> tuple[ChatManager | None, Path | None]:
        """``(chat manager, state.db)`` of the profile whose store owns ``session_id``."""
        for name, home in self._walk_profiles(session_id):
            context = self._base if not name else self._contexts.get(name)
            if context is not None and context.chat is not None:
                return context.chat, home / "state.db"
        return None, None

    def _walk_profiles(self, session_id: str):
        """Yield ``(profile_name, home)`` pairs whose store claims ``session_id``."""
        root = Path(self._base.settings.hermes_home)
        if _claims_session(root / "state.db", session_id) is not None:
            yield "", root
        try:
            from astra.profiles import profile_home, profile_names

            names = profile_names(root)
        except Exception:  # pragma: no cover - profile enumeration is optional
            return
        for name in names:
            try:
                home = profile_home(root, name)
            except Exception:
                continue
            if _claims_session(home / "state.db", session_id) is not None:
                yield name, home

# Background subagent completions

Hermes runs **every** top-level `delegate_task` in the background: the tool call returns a
handle, and the child's result arrives later as a `type="async_delegation"` event on the
process-global `tools.process_registry.completion_queue`. Delivering that event is the surface's
job — the gateway has `_async_delegation_watcher`, the TUI has its notification poller.

Astra had no consumer, and Hermes' "can this session receive a detached result?" capability
defaults to *yes* for anything that does not declare otherwise. So on the WebUI a delegation:

1. was dispatched with `background=true` (the model is told "end your turn; the result will
   re-enter the conversation"),
2. completed,
3. pushed its event onto a queue nothing drained — the durable row in
   `state.db:async_delegations` stayed `delivery_state='pending'`, `delivery_attempts=0`, forever,
4. and the parent conversation never learned the child had finished.

`astra/completions.py` is that consumer.

## What it does

`CompletionConsumer` runs for the lifetime of the app (started in the `create_app` lifespan,
cancelled on shutdown) and polls once a second:

* drains only `async_delegation` events and puts everything else back untouched;
* resolves the target chat by `parent_session_id` (falling back to the origin/routing keys), and
  walks a subagent session up to the nearest conversation that can actually show a message;
* claims the completion through Hermes' durable delivery claim (`claim_event_delivery`), so a
  second process or a restart replay cannot deliver the same result twice;
* starts a **real turn** with `ChatManager.start_completion_turn`, persisting the trigger as a
  `display_kind="async_delegation_complete"` notice row (`display_metadata.display_text` is the
  compact title the transcript paints) while the model still receives Hermes' full notification
  text as the user message — the same shape the TUI's notification poller submits;
* acknowledges the claim with `complete_event_delivery` once the turn is registered.

The agent then continues with the result in context, which is what makes it act on a subagent's
output (open the PR, apply the fix) instead of waiting to be asked.

## Failure behaviour

| Situation | Behaviour |
|---|---|
| Dispatching turn still running | Event goes back on the queue; **no delivery attempt is spent**. The next tick after the turn ends delivers it. |
| Two consumers (restart replay, second process) | The durable claim is atomic — exactly one starts the turn. |
| Session unknown to this process | Claimed and terminally `dropped` with a log line, so nothing sits pending forever. |
| Turn start raised | Claim deferred (busy/chat errors, attempt refunded) or released (unexpected errors, one attempt spent, converging to `dropped`). |
| Consumer not running at all | Turns bind Hermes' `async_delivery=False`, so delegation runs synchronously and the result comes back inside the tool call. Never silently detached. |

On process start Hermes replays durable pending completions (up to 48 h old) onto the queue, so
results lost before this consumer existed are delivered once at the next restart.

## Verifying

Unit coverage: `backend/tests/test_completions.py` (routing, retry accounting, dedupe, subagent
ancestor resolution, notice-shaped turn). End-to-end against a copy of a real `state.db`:

```sh
HERMES_HOME=<copy-of-home> PYTHONPATH=backend/src:<hermes-src> python - <<'PY'
import asyncio, json, sqlite3
from types import SimpleNamespace
from astra.completions import CompletionConsumer

# ... load a pending event row, build a consumer with a stub chat, then:
print(asyncio.run(consumer.deliver(event)))          # True
print(db.execute("SELECT delivery_state FROM async_delegations WHERE delegation_id=?",
                 (event["delegation_id"],)).fetchone())   # ('delivered',)
PY
```

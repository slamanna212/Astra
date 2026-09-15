# Hermes Web — Build Specification & Plan

**Version:** 1.0
**Date:** 2026-09-15
**Audience:** An implementing engineer/agent with **no prior context**. This document is self-contained.
**Status:** Design locked. Nothing has been built or deployed.

---

## 0. Read this first

We are building a **replacement front-end and backend for an existing single-user Hermes Agent deployment**
running in Kubernetes. It replaces a third-party UI (`nesquena/hermes-webui`) that is Python + vanilla JS,
has no build step, and keeps a **second copy of all conversation history** as flat JSON on a network volume.

**The hard requirement:** the new app must import Hermes' own Python modules directly and share the existing
persistent volume. It must **not** build a parallel store of conversations, and it must **not** call the
loopback HTTP API server for chat.

**Scale of the real data this must handle** (measured 2026-09-15 on the live volume):

| Metric | Value |
|---|---|
| Canonical sessions in `state.db` | 431 |
| Canonical messages in `state.db` | 36,448 |
| `state.db` size | 332,652,544 bytes (~332 MB) |
| Legacy UI's duplicate JSON store | 342 files, **335.61 MB** |
| Largest single conversation | 3,147 messages |
| FTS index status | present; `MATCH 'hermes'` → 15,322 hits in **45 ms** |

Anything that parses whole conversations as JSON on the request path is disqualified by construction. See §7.

---

## 1. Environment facts (all verified — do not re-derive, but DO re-verify before relying)

### 1.1 Hermes

- Version **0.21.0**, release date `2026.8.31`.
- Agent source tree available at **`/app/hermes-agent-src`** (this is the copy the current UI imports from).
  Also at `/home/hermeswebui/.hermes/hermes-agent` (byte-identical for the audited files).
- The agent package root contains `run_agent.py` (module `run_agent`), `hermes_state.py` (module `hermes_state`),
  `cron/` (package with `jobs.py`, `scheduler.py`), `tools/` (`skills_tool.py`, `skill_manager_tool.py`,
  `cronjob_tools.py`, `clarify_tool.py`), `api/`, `gateway/`, `hermes_cli/`, `tui_gateway/`.
- There is **no `.git`** in either tree, so commit provenance is not provable. Do not attempt `git describe`.

### 1.2 Kubernetes

- Deployment **`hermes/hermes`**, replicas **1**, strategy **Recreate** (`rollingUpdate: null`),
  termination grace **120s**.
- Containers today: `hermes-agent`, `hermes-webui`, `ai-usage-collector`, `chromium`.
  Two init containers: `prepare`, `install-ai-collector-deps`.
- **`hermes-agent` container image is pinned**:
  `nousresearch/hermes-agent:v2026.8.31@sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524`
- **`hermes-webui` container image**: `ghcr.io/nesquena/hermes-webui:0.52.264`
- Service `hermes` is a **LoadBalancer** pinned via annotation to **`10.1.20.205`**, exposing ports
  **8787** (legacy UI) and **9119** (official dashboard) only.
- Volume: PVC **`hermes-data`**, **ReadWriteOnce**, storageClass **`longhorn`**, **40Gi**,
  bound PV `pvc-8718fac8-1105-4b50-8271-bc875edc1925`, attached to node `slama-read-k8work01v`.
- Backup: k8up schedule `hermes-backup`, daily `0 2 * * *`, retention keepLast 7 / keepWeekly 4,
  destination B2 S3 `rapturek8up/hermes`.
- GitOps: repo **`slamanna212/HomelabArgoCD`**, branch `main`. ArgoCD auto-syncs.
  Application manifests under `workloads/hermes/`. The `hermes` Argo app was Synced/Healthy at
  revision `9ad5639f1690254f84361be25568e344f252f650`.

### 1.3 Mounts — the part that matters most

The **same PVC** is mounted by two containers at **different absolute paths**:

| Container | `home` subPath mounted at | `workspace` subPath mounted at |
|---|---|---|
| `hermes-agent` | `/home/hermes/.hermes` | `/workspace` |
| `hermes-webui` | `/home/hermeswebui/.hermes` | `/workspace` |

Both are **read-write**. `fsGroup: 1000`, `fsGroupChangePolicy: OnRootMismatch`. Container UID/GID is
**1000:1000** in the WebUI container.

**Consequence:** if the new container mounts the same volume at a third path, `$HERMES_HOME` must be set
explicitly and every path must be derived from it. **Never hardcode a lane path.** This exact bug has already
caused failures in this deployment (a cron job failed with `No such file` because a script hardcoded
`/home/hermeswebui/...` while cron executes in the gateway lane at `/home/hermes/...`).

### 1.4 Live network listeners inside the pod's shared network namespace

| Port | Binding | Owner |
|---|---|---|
| 8642 | `127.0.0.1` only | Hermes agent HTTP API server |
| 9222 | `127.0.0.1` only | Chromium CDP |
| 8787 | `0.0.0.0` | legacy WebUI |
| 9119 | `0.0.0.0` | official dashboard |
| 9100 | `0.0.0.0` | ai-usage metrics |

**Containers in one pod share a network namespace**, so a new container in this pod can reach
`127.0.0.1:8642` if it ever needed to. It will not need to (see §4.1).

### 1.5 OpenViking (the memory backend)

- Endpoint: `http://openviking.openviking.svc.cluster.local:1933`, version **v0.4.17.1**, `auth_mode: trusted`.
- Auth headers required on `/api/v1/*`: `X-API-Key`, `X-OpenViking-Account`, `X-OpenViking-User`.
- Credentials live in the Hermes `.env`: `OPENVIKING_API_KEY`, `OPENVIKING_ACCOUNT` (=`default`),
  `OPENVIKING_USER` (=`default`), `OPENVIKING_ENDPOINT`. **Never print or log the key.**
- Only `/health`, `/ready`, `/openapi.json` are unauthenticated.
- `/openapi.json` is the source of truth — endpoints are **removed** between minor versions.

### 1.6 Secrets

Never print, log, commit, or send to the browser: `API_SERVER_KEY`, any provider API key,
`OPENVIKING_API_KEY`, dashboard auth secrets, `.env` contents, `auth.json` contents.

---

## 2. Why the existing UI is being replaced (evidence, not opinion)

| Problem | Evidence |
|---|---|
| Duplicate conversation store | 342 JSON files / 335.61 MB beside a 332 MB canonical `state.db` |
| Slow opens | **21.4 ms to parse one** session body; **3,787 ms for 200** |
| No build step, no types | `/app/package.json` states "pure Python + vanilla JS with no bundler" |
| Monolith source | `api/routes.py` ≈ 29,400 lines; `static/panels.js` 13,475 lines |
| Whole-transcript DOM rendering | hand-written `static/ui.js` / `panels.js` |
| Missing sessions | 96 sessions exist **only** in `state.db` (Discord, cron, CLI) — the UI cannot show them |
| Single-threaded process | stdlib `ThreadingHTTPServer` with the agent in-process |

The replacement fixes these by importing Hermes directly (same trick that makes the old UI capable),
but with a modern frontend, a canonical single source of data, and a non-blocking execution model.

---

## 3. Non-negotiable constraints

1. **`state.db` is the single source of truth for conversations.** No second session store. Ever.
2. **Import Hermes Python directly.** `from run_agent import AIAgent`, `from cron.jobs import ...`, etc.
3. **Do not call the HTTP API server (port 8642) for chat.** It is loopback-only, its Runs API has a single
   draining queue with no replay, and it lacks a clarify bridge.
4. **Mount the existing PVC.** Same data, same place as Hermes.
5. **Never hardcode a lane path.** Derive everything from `$HERMES_HOME`.
6. **Never expose provider API keys or the gateway bearer to the browser.** The Vite bundle is readable by anyone
   who loads the page. Secrets live server-side only. This is the one security rule that is absolute.
7. **Do not add a database.** No Postgres, no Redis, no second SQLite for conversations. (A small UI-preferences
   store is acceptable and must be clearly separate — see §6.9.)
8. **Run the agent off the event loop.** Never block the ASGI loop with a model turn.
9. **Land every deployable change in Git.** ArgoCD is the source of truth; no ad-hoc `kubectl apply`.

---

## 4. Backend specification (Python + FastAPI)

### 4.1 Why Python and not TypeScript

Everything needed is a **direct Python import**. Verified receipts from the reference implementation:

- Agent: `/app/api/agent_runtime.py:149` → `from run_agent import AIAgent`
- Cron list: `/app/api/routes.py:1535` → `from cron.jobs import list_jobs`
- Cron run: `/app/api/routes.py:1660-1662` → `from cron.scheduler import run_job` + `run_job(job)`
- Cron write: `/app/api/routes.py:24669,24723` → `from cron.jobs import create_job, update_job`
- Sessions: `/app/api/state_sync.py:48` → `from hermes_state import SessionDB`
- Skills: `/app/api/routes.py:869-885` → `from tools.skills_tool import ...`
- Memory commit: `/app/api/session_lifecycle.py:215` → `AIAgent.commit_memory_session()`

A TypeScript backend would still require a Python sidecar for all of the above, producing two services and two
deploy paths for one feature set. One Python service is strictly simpler.

**Frontend remains React + TypeScript + Vite + Mantine.** The language split is deliberate: TypeScript for the
UI, Python for the integration layer.

### 4.2 Process and execution model — the core performance decision

```
┌──────────────────────────────────────────────────────────────┐
│  uvicorn / FastAPI (single asyncio event loop)               │
│                                                              │
│   • session list, history, search, cron, files, logs  ← fast  │
│   • SSE fan-out to browsers                           ← async │
│   • NEVER runs a model turn                                   │
│                                                              │
│              ┌────────────────────────────────────────┐      │
│              │ AgentExecutor: ThreadPoolExecutor      │      │
│              │   max_workers = 4 (start here)         │      │
│              │   one AIAgent per active session       │      │
│              │   turns are blocking Python calls      │      │
│              └────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- A user turn is submitted to the executor via `loop.run_in_executor(...)` (or `anyio.to_thread.run_sync`).
  The event loop is **never** blocked by agent work.
- Agent callbacks (`stream_delta_callback` etc.) are called **from the executor thread**. They must only
  push onto a thread-safe `queue.Queue` (or call `loop.call_soon_threadsafe`). **No direct awaits inside callbacks.**
- A per-session async pump task drains that queue and yields SSE frames to all subscribed browsers.
- Session state (the `AIAgent` instance) is cached per session id, guarded by a per-session lock.
  Reuse matters: rebuilding the agent every turn loses `_user_turn_count` and breaks first-turn-only injection.

**Why this is the whole point:** the old UI runs the turn on the request thread of a `ThreadingHTTPServer`
with one GIL, so a long turn and a page load contend. Here, list/history/status/search remain responsive
while a turn runs.

### 4.3 The agent interface (verified signatures — `AIAgent.__init__`)

Construct with keyword arguments. Guard every optional kwarg against `inspect.signature(AIAgent.__init__).parameters`
so a Hermes upgrade that drops a parameter does not crash the app (the reference implementation does exactly this).

Confirmed-working construction (from `/app/api/streaming.py:10220-10239`):

```python
agent = AIAgent(
    model=...,                       # resolved model id
    base_url=...,                    # resolved provider base url
    api_key=...,                     # resolved provider key — server-side only
    platform='webui',                # keep 'webui'; do not invent a new platform name
    quiet_mode=True,
    enabled_toolsets=_toolsets,       # list of toolset names
    fallback_model=_fallback_resolved,
    session_id=session_id,            # the canonical state.db session id
    session_db=_session_db,           # hermes_state.SessionDB instance
    prefill_messages=_prefill_messages,
    stream_delta_callback=on_token,
    reasoning_callback=on_reasoning,
    tool_progress_callback=on_tool,
    clarify_callback=lambda question, choices: ...,
)
```

Optionally supported (guard before passing): `reasoning_config`, `interim_assistant_callback`,
`tool_start_callback`, `tool_complete_callback`, `status_callback`, `max_iterations`, `max_tokens`,
`request_overrides`, `api_mode`, `credential_pool`, `gateway_session_key`.

Then execute a turn:

```python
result = agent.run_conversation(**run_kwargs)
```

`run_conversation` takes `user_message` plus context/turn arguments — **introspect the real signature at
runtime** (`inspect.signature(agent.run_conversation)`) and pass only what it accepts. The reference
implementation builds `_run_conversation_kwargs` conditionally for exactly this reason
(`/app/api/streaming.py:10728-10740`).

**Cancellation:** the reference uses a `threading.Event` (`cancel_event`) checked between steps and passed into
callbacks. Reproduce that pattern for stop/interrupt.

### 4.4 Session storage contract

`state.db` is SQLite (WAL mode) at `$HERMES_HOME/state.db`. Access it through **`hermes_state.SessionDB`**
(do not hand-write SQL for writes), but **read-only direct SQL is acceptable and preferred for list/search**
where it is faster. Verified `sessions` columns:

```
id, source, user_id, session_key, chat_id, chat_type, thread_id, display_name, origin_json,
expiry_finalized, model, model_config, system_prompt, system_prompt_hash, parent_session_id,
started_at, ended_at, end_reason, message_count, tool_call_count, input_tokens, output_tokens,
cache_read_tokens, cache_write_tokens, reasoning_tokens, cwd, git_branch, git_repo_root,
billing_provider, billing_base_url, billing_mode, estimated_cost_usd, actual_cost_usd,
cost_status, cost_source, pricing_version, title, last_activity_at, last_activity_description,
last_activity_provenance, api_call_count, handoff_state, handoff_platform, handoff_error,
compression_failure_cooldown_until, compression_failure_error, compression_fallback_streak,
compression_ineffective_count, profile_name, rewind_count, archived, pinned, title_source,
last_read_at, git_metadata_generation, hidden
```

**Note:** there is no `updated_at` column on `sessions`. Order by `last_activity_at` (fallback
`started_at`). This was confirmed by a failing query, so do not guess column names — introspect.

**Read-only access pattern:** open with
`sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`. WAL means readers are fine, but `immutable=1` is
**wrong** for a live changing DB — do not use it.

**Benefits available for free:** FTS5 full-text search over messages (`messages_fts`), measured at 45 ms
across 36,448 messages. Use it. `display_kind` on messages marks non-conversation rows that must be preserved
for ID reconciliation but not necessarily rendered as chat.

### 4.5 HTTP API for the browser

All routes authenticated. Assume a single user but still require a session.

**Chat**
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat/{session_id}/send` | Submit a turn |
| GET | `/api/chat/{session_id}/stream` | SSE: tokens, reasoning, tool events, approvals, clarify, done |
| POST | `/api/chat/{session_id}/stop` | Cooperative interrupt |
| POST | `/api/chat/{session_id}/steer` | Inject guidance into a running turn |
| POST | `/api/chat/{session_id}/answer` | Answer a pending clarify/approval request |

**Sessions**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sessions` | List, paginated, ordered by `last_activity_at` |
| POST | `/api/sessions` | Create |
| GET | `/api/sessions/{id}` | Detail |
| PATCH | `/api/sessions/{id}` | title / pinned / archived / hidden |
| DELETE | `/api/sessions/{id}` | Delete |
| GET | `/api/sessions/{id}/messages` | Paged message window |
| GET | `/api/search?q=` | FTS5 message search |

**Cron** (every field editable — this is the capability the old UI lacks)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cron` | List (include disabled) |
| GET | `/api/cron/{id}` | Detail |
| POST | `/api/cron` | Create |
| PATCH | `/api/cron/{id}` | Update — pass through any field `update_job` accepts |
| DELETE | `/api/cron/{id}` | Delete |
| POST | `/api/cron/{id}/run` | Manual run |
| POST | `/api/cron/{id}/pause` \| `/resume` | Toggle |
| GET | `/api/cron/{id}/output` | List run outputs |
| GET | `/api/cron/{id}/output/{run}` | One run's markdown |

`update_job(job_id, updates)` accepts arbitrary keys, rejects only immutable ones, and explicitly normalizes
`script`, `post_script`, `monitor_script`, `monitor_url`, `workdir`, `reasoning_effort`, `repeat`
(`/app/hermes-agent-src/cron/jobs.py:2523-2564`). **The UI must therefore expose at minimum:**
`schedule, name, prompt, deliver, skills, repeat, script, post_script, no_agent, context_from, continuity,
monitor_script, monitor_url, workdir, model, provider, reasoning_effort, enabled_toolsets`.

> The three jobs on this deployment that need these fields and cannot currently be edited anywhere:
> `Daily Briefing` (`post_script`), `memory-reflection` + `memory-lifecycle-sweep` (`context_from`),
> `Astra mail watcher` (`monitor_script`).

**Skills** — list from `$HERMES_HOME/skills`, read/write `SKILL.md`, toggle enablement.
Enablement is **config, not filesystem**: toggle updates `skills.disabled` (and
`skills.platform_disabled.webui`) in `config.yaml`. Reproduce these guards from the reference
(`/app/api/routes.py:27934-27982`):

- normalize name: `strip().lower().replace(" ", "-")`
- reject empty, `/`, `..` in name and category
- containment check: `resolved.relative_to(skills_dir.resolve())`
- refuse symlinked `SKILL.md`

**Memory**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/memory/files` | Read `MEMORY.md`, `USER.md`, `SOUL.md` |
| PUT | `/api/memory/files/{which}` | Write one of them (refuse symlinks) |
| POST | `/api/memory/commit/{session_id}` | Trigger OpenViking session commit |
| GET | `/api/openviking/health` | `/health` + `observer/system` |
| GET | `/api/openviking/tree?uri=` | `fs/ls` / `fs/tree` |
| GET | `/api/openviking/stat?uri=` | `fs/stat` (+ subtree indexed `count`) |
| GET | `/api/openviking/content?uri=&offset=&limit=` | `content/read`, plus `abstract`/`overview` |
| POST | `/api/openviking/search` | `search/find` (fast) or `search/search` (deep, `mode=context`) |
| GET | `/api/openviking/status` | `observer/{queue,lock,vikingdb,models,retrieval}`, `stats/memories`, `tasks` |

**Files / Logs / Insights**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files?path=` | Directory listing |
| GET | `/api/files/content?path=` | File content |
| GET | `/api/files/download?path=` | Download |
| POST | `/api/files/upload` | Upload |
| GET | `/api/logs?file=&lines=&level=&search=` | Tail a log |
| GET | `/api/insights?days=` | Usage/token/cost aggregation from `state.db` |

**Log allowlist is 3 files.** Only `agent.log`, `errors.log`, `gateway.log` under `$HERMES_HOME/logs`.
Anything else → 400. Tail only, hard cap on bytes. Do not add an arbitrary `?file=` parameter.

**Insights:** aggregate from `state.db` (`sessions.input_tokens`, `output_tokens`, `cache_read_tokens`,
`reasoning_tokens`, `estimated_cost_usd`, `actual_cost_usd`, `api_call_count`, plus the
`session_model_usage` table for auxiliary-task spend). **Do not** copy the old UI's approach of walking
its own JSON index.

### 4.6 Agent and memory lifecycle details that are easy to get wrong

- **Commit memory at session boundaries.** OpenViking only receives memories when
  `AIAgent.commit_memory_session()` runs, which the reference triggers via
  `api.session_lifecycle.commit_session_memory(session_id, agent=..., wait=...)` on new-session,
  eviction, and shutdown. Do the same — otherwise memories silently stop being created.
  It can take 1–5+ seconds and must never run on the request path; use a background thread.
- **Agent cache identity.** Cache key must include model, provider/key identity, and toolsets.
  If any of these change mid-session, rebuild the agent.
- **`platform='webui'`** keeps Hermes from injecting CLI-specific guidance. Keep it.
- **Message role alternation is a hard invariant**: never two consecutive `user` or two consecutive
  `assistant` messages. Only `tool` results may repeat.
- **Never rewrite history.** Don't change past context, toolsets, or the system prompt mid-conversation —
  it invalidates the provider's prompt cache and costs real money and latency.
- **Preserve `display_kind` rows** when paginating history so row-ID reconciliation stays correct.

---

## 5. Frontend specification (React + TypeScript + Vite + Mantine)

### 5.1 Stack — locked

| Concern | Choice |
|---|---|
| Build | **Vite** (not Next.js — no SSR/SEO need, and it is heavy) |
| Framework | **React 18+ with TypeScript** |
| UI kit | **Mantine** — `@mantine/core`, `hooks`, `notifications`, `modals`, `spotlight`, `dates`, `charts`, `code-highlight`, `dropzone` |
| Server state | **TanStack Query** |
| Transcript rendering | **TanStack Virtual** |
| Routing | React Router |
| Tests | Vitest + Testing Library; Playwright for the end-to-end flows in §9 |

Mantine + Vite setup: PostCSS with `postcss-preset-mantine` + `postcss-simple-vars`, then
`MantineProvider` at the root with `@mantine/core/styles.css` imported. Follow the official
Vite guide so the theme, color-scheme script, and CSS variables are wired correctly.

### 5.2 Navigation

Left nav (Mantine `AppShell`), mobile-collapsible:

**Chats · Scheduled tasks · Skills · Memories · Files · Insights · Logs**

### 5.3 Chat view — the screen that must be excellent

- Virtualized transcript. Only visible rows in the DOM. This is non-negotiable at 3,147-message sessions.
- Distinct, attractive components for: user message, assistant text (streaming), reasoning ("Thinking"),
  tool call (with args summary, duration, status, expandable result), subagent activity, approval request
  (Approve once / session / always / Deny), clarify question (choices or free text), and file/image parts.
- Composer: multiline auto-grow, Enter to send, Shift+Enter newline, attachment button, model picker,
  stop button while running, steer input while running.
- Streaming: append via SSE; batch DOM updates (do not re-render per token). Coalesce deltas on a ~30–50 ms
  timer before committing to state.
- Auto-scroll that follows the stream but **yields** if the user scrolls up, with a "jump to latest" affordance.
- Show connection state; on reconnect, refetch the tail of history and re-sync rather than assuming no gap.
- Late-arriving steers: if a steer was accepted but not consumed, the backend must return it so the UI can
  resend it as the next user turn instead of losing it.

### 5.4 Scheduled tasks view

- Table/list: name, schedule (human-readable), enabled, next run, last run + status, delivery target.
- Detail pane exposing **every** field in §4.5's cron list, including the advanced ones.
- Output viewer rendering `output/<job_id>/*.md` with per-run metadata.
- Create/edit form with a schedule builder (presets + raw cron + "every N") and a clear warning that
  duration forms like `30m` run once, whereas `every 30m` recurs.
- Manual **Run now**, pause/resume, delete.
- Live updates pushed from the server, not polled.

### 5.5 Memories view

Two panels:

1. **Working memory** — `MEMORY.md`, `USER.md`, `SOUL.md`, editable, with the config gates respected
   (`memory.memory_enabled`, `memory.user_profile_enabled`).
2. **OpenViking inspector** — tree browser (`fs/ls`/`fs/tree`), per-node indexed-count badge (`fs/stat.count`),
   document viewer with L0 abstract / L1 overview / full text, search box (fast `find` and deep `context`
   search), and a status panel (queue depth, lock conflicts, vector count, model usage, retrieval quality,
   memory census, recent tasks).

OpenViking behaviours the UI **must** respect (each observed live):

- **Do not use `/ready` as a health signal.** It flapped `503 not_ready` while browse/read/search all worked,
  and took 7.3 s. Use `/health` + `observer/system` for liveness; treat `/ready.checks.embedding` as an
  embedding-provider hint only. Never paint "down" from it.
- **Health ≠ searchable.** `viking://user/default/sessions` has **0** vector rows: archived session transcripts
  are browsable but not searchable. Do not promise "search everything".
- **Never enumerate `debug/vector/scroll`.** Two identical walks returned 626 vs 649 distinct URIs with ~400
  duplicate rows each, and one 50-record page was 4.5 MB (it embeds 4096-dim vectors and document content).
  Use per-URI queries only.
- **Browse does not paginate.** `fs/ls recursive` silently truncates at 1000 nodes with no cursor. Drill down
  per directory; do not present a flat listing as complete.
- **Pass `show_all_hidden=true`** or directories undercount (memories 117 vs 148 files; skills 0 vs 2).
- **Pass `peer_scope: "actor"`** on search or the UI will display **another peer's** memories
  (`peer_scope` defaults to `all`; hits carry `"origin": "other_peer"`).
- **Search has two response shapes on one route**: `mode:"list"` returns
  `{memories, resources, skills, total}`; `mode:"context"` returns `{entries, rendered, digest, stats}`.
  Branch on mode. `query_expansion` requires `mode=context`; `target_uri` is rejected in `mode=context`.
- **`X-OpenViking-Account` / `X-OpenViking-User` are client-asserted, not authorization** — an unknown account
  silently served the default tenant's data. Fix them server-side; never accept them from the browser.
- **`/metrics` 404s** despite being in the spec; `bot/*` 503s (relation graph unavailable);
  `system/backend/sync-status` 403s.

### 5.6 Files view

Directory browser over the workspace, upload/download, inline preview for text and images, and open-in-new-tab
for generated artifacts. Keep the reference's deny-wall: never expose `.env`, `auth.json`, `state.db`,
`config.yaml`, `jobs.json`, `settings.json`, or the `sessions/`, `memories/`, `cron/`, `logs/`, `checkpoints/`,
`backups/` directories through the *file browser* (dedicated screens handle those with proper semantics).

### 5.7 Insights view

Token/cost/session charts from `state.db`: daily tokens and spend, per-model and per-provider breakdown,
per-task (auxiliary) spend, cache-hit rate, tool-call counts, session counts. Use Mantine `charts`.

### 5.8 Logs view

Tabbed tailer for the three allowed files, with level and substring filters, auto-follow toggle, and a
copy/download of the visible window. Redact obvious secret patterns before display.

### 5.9 UI preferences

Small, clearly separate store (e.g. a `ui_prefs` table in a **new, separate** SQLite file, or a JSON file under
a UI-owned directory). It may hold theme, sidebar state, and per-user view settings. **It must never hold
conversation content.**

---

## 6. Efficiency rules (violating these recreates the problem we are replacing)

1. **One source of conversation truth** — `state.db`.
2. **Never parse a whole conversation to render a list.** Lists come from indexed columns.
3. **Page everything.** Message windows (e.g. 200), bounded list pages, bounded log tails.
4. **Virtualize any list that can grow** — transcripts, sessions, files.
5. **Push, don't poll.** SSE for streaming and status. If a poll is unavoidable, use a change-signal
   (e.g. `mtime` of `cron/jobs.json`) not a fixed 30-second timer.
6. **Never block the event loop.** All agent work and any heavy parse goes to the executor.
7. **Coalesce stream deltas** before touching React state.
8. **Reuse the cached agent** per session rather than rebuilding per turn.
9. **Read-only SQLite connections** for all browser-facing reads.
10. **Stream file downloads**; never base64 a large file into JSON.

---

## 7. Deployment specification

### 7.1 Recommended shape

Add the app as an **additional container in the existing `hermes` pod**, built as an image derived from the
pinned Hermes image so the imported source always matches the running version.

```
FROM nousresearch/hermes-agent:v2026.8.31   (pin by tag@digest as the deployment does)
  • copy the built frontend (Vite dist)
  • copy the backend service code
  • install backend deps into a venv (fastapi, uvicorn[standard], httpx, python-dotenv)
  • do NOT install anything at pod startup
  • entrypoint: uvicorn app.main:app --host 0.0.0.0 --port <new port>
```

Mounts to declare (mirroring the existing containers, **same `subPath`s**):

| Volume | subPath | Mount |
|---|---|---|
| `home` | `home` | `/home/hermeswebui/.hermes` (or any path — set `HERMES_HOME` to it explicitly) |
| `workspace` | `workspace` | `/workspace` |

- Set `HERMES_HOME` explicitly and derive every path from it.
- `fsGroup: 1000`; run as UID/GID 1000.
- Add a `containerPort` for the new service and add it to the existing `hermes` Service, or create a
  second Service on the same LB IP.

**Trade-off, stated plainly:** this Deployment is `Recreate`, so **every UI deploy restarts the whole pod**,
including the gateway, cron, and in-flight chats. That is already true today when the WebUI image is bumped.
The upside is that PVC sharing and version parity are free, and there is no RWO scheduling problem.

### 7.2 Alternative shape (documented, not recommended)

A **separate Deployment** with the PVC mounted via required `podAffinity` to the Hermes node. This gives
independent UI rollouts. Costs: RWO means same-node only; a pod holding the volume attachment can block
Hermes from starting on another node; and the Hermes image tag must be pinned manually and kept in sync.
**Only choose this if independent rollout becomes a real need.** If chosen, prefer **not** mounting the PVC
at all and reaching data through an authenticated internal service instead.

### 7.3 GitOps procedure (mandatory)

The repo is `slamanna212/HomelabArgoCD`. **Never `kubectl apply` an application workload**; ArgoCD owns it and
will revert you. **Never clone the repo** — use the GitHub API (`gh api`) to read, and the Git Trees API to
commit. Commits are authored by the `voyager-slama[bot]` GitHub App identity.

Sequence:
1. Read the current manifest bytes fresh from `main` immediately before editing (`gh api
   /repos/slamanna212/HomelabArgoCD/contents/<path>`).
2. Edit surgically — exact-string replacement, never a YAML/JSON round-trip (a round-trip reformats the file
   and buries a two-line change in ~50 lines of churn).
3. Commit via blobs → tree (`base_tree` must be the base **commit's tree SHA**, not the commit SHA) → commit
   → branch → PR. Nested JSON must be sent with `gh api --method POST --input <file>.json`.
4. Inspect the PR file list and diff before asking for merge. If an untouched file's blob SHA differs from
   `main`, a stale local copy is about to revert someone else's fix — re-fetch and rebuild.
5. After merge, poll ArgoCD until `revision` matches the commit, then verify the workload is healthy **and**
   exercise the feature.

### 7.4 Access

- **Cloudflare Tunnel + Access** for access from work. A `cloudflared` Deployment already exists
  (`cloudflare/cloudflared:latest`, 3 replicas, remote-managed token) — routes and Access policy are managed
  remotely, not in Git.
- **VPN/private routing** for home access.
- Keep application authentication on **both** paths; do not let the tunnel be the only gate.
- **Never expose** port 8642 (agent API) or 9222 (CDP) through the LB or tunnel.

### 7.5 Container hardening

Run as non-root UID 1000, drop capabilities, `seccompProfile: RuntimeDefault`, read-only root filesystem with an
explicit writable scratch (e.g. `emptyDir` for `/tmp`), `automountServiceAccountToken: false`, CPU/memory
requests and limits, and startup + readiness probes. Do not repeat the collector pattern of installing packages
at pod start.

---

## 8. Build plan

Each phase ends in something runnable and verifiable. **Do not start a phase before the previous one's
acceptance criteria pass.**

### Phase 0 — Skeleton and data access (foundation)
Build the repo scaffold: FastAPI app, Vite + Mantine frontend, health endpoint, config module resolving
`HERMES_HOME`, read-only `state.db` access layer, and structured logging.
**Accept:** `/api/health` returns ok; `/api/sessions` returns real paginated sessions from `state.db` in
under 50 ms for 50 rows; no second store is created.

### Phase 1 — Read-only screens
Sessions list, conversation viewer with virtualization, message-window paging, FTS search, cron list + detail
+ run outputs, skills list, files browser, logs tailer, insights charts.
**Accept:** all seven nav areas load real data; a 3,147-message conversation scrolls smoothly; the session list
shows the 96 sessions that exist only in `state.db`; search returns results in well under a second.

### Phase 2 — Chat
Executor + per-session agent cache, SSE streaming, message persistence into `state.db`, stop, steer,
approval and clarify cards, model picker.
**Accept:** a real turn streams to completion; a second browser tab on the same session sees the same live
stream; stop interrupts within a few seconds; a clarify question renders, is answered, and the turn continues;
the conversation appears in Discord/CLI-visible history (same `state.db`) and vice versa.

### Phase 3 — Writes and cron parity
Cron create/edit/delete/run with **all** advanced fields; skill create/edit/toggle/delete; memory file editing;
file upload/download; UI preferences.
**Accept:** `Daily Briefing`'s `post_script`, `memory-reflection`'s `context_from`, and the Astra watcher's
`monitor_script` can all be viewed **and edited** in the UI and the change is visible in `jobs.json`.

### Phase 4 — Memory inspector and OpenViking status
Full §5.5 implementation.
**Accept:** tree browse, per-node index badge, document read at all three levels, fast and deep search scoped
to `actor`, and a status panel showing queue/lock/vector/retrieval state — with the "checked and empty" case
visually distinct from "backend unreachable".

### Phase 5 — Hardening and cutover
Auth, container hardening, probes, mobile/PWA polish, performance pass, Playwright end-to-end tests,
runbook, and cutover with rollback documented.
**Accept:** the flows in §9 pass on desktop and phone; a UI-only deploy is exercised and recorded.

---

## 9. Acceptance tests (must actually be run before cutover)

1. Open a 3,000+ message conversation on desktop and on a phone; scrolling stays smooth.
2. Start a long turn, close the browser, reopen on another device: the turn is still running and output is
   recovered without duplication or gaps.
3. Two clients on one session simultaneously: both see the stream; closing one does not interrupt.
4. Stop mid-turn; confirm the agent stops and the partial transcript is intact.
5. Steer mid-turn; confirm the guidance is applied — and if it arrives too late, that it is returned and not lost.
6. Trigger an approval-required command and a clarify question; answer both from the UI.
7. Edit `post_script` on a job; verify in `jobs.json`; run the job and confirm the hook fires.
8. Confirm OpenViking receives a session commit after a boundary, and the new memory is searchable.
9. Confirm the UI shows sessions originating from Discord and cron.
10. Kill the app process mid-turn; confirm behaviour is understood and the transcript is consistent (no
    corrupted rows).
11. Search across 36k messages returns in under a second.
12. Confirm no secret (provider key, gateway bearer, OpenViking key) appears in the built frontend bundle,
    in any API response, or in logs.

---

## 10. Traps — each of these cost real time already

| Trap | Rule |
|---|---|
| Second session store | Never. `state.db` only. |
| Assuming column names | `sessions` has **no** `updated_at`; introspect with `PRAGMA table_info`. |
| `immutable=1` on SQLite | Wrong for a live WAL database. Use `mode=ro`. |
| Hardcoding a lane path | `/home/hermeswebui/.hermes` ≠ `/home/hermes/.hermes`. Derive from `$HERMES_HOME`. |
| Rebuilding the agent each turn | Breaks first-turn-only injection; cache per session. |
| Blocking the event loop | Agent turns go to the executor, always. |
| Trusting `/ready` on OpenViking | It flaps. Use `/health` + `observer/system`. |
| Enumerating `debug/vector/scroll` | Unstable, duplicate rows, megabytes of vectors. Per-URI only. |
| Flat `fs/ls recursive` | Truncates at 1000 nodes silently. Drill down. |
| Forgetting `peer_scope` | Defaults to `all` and shows another peer's memories. |
| Trusting account/user headers | Client-asserted, not authorization. Fix server-side. |
| Polling on a timer | Push instead (SSE). |
| Rendering whole transcripts | Virtualize. |
| Putting keys in the frontend | Never — the bundle is public. |
| `kubectl apply` | ArgoCD owns it; use Git. |
| Cloning the GitOps repo | Use `gh api`. |
| YAML/JSON round-trip edits | Surgical string replacement only. |
| Skipping memory commits | Without `commit_memory_session()` OpenViking stops learning. |

---

## 11. Verified vs unverified (do not blur these)

**Verified** — live probes, direct reads, or measured timings in this deployment on 2026-09-15:
Hermes 0.21.0; source paths and the `AIAgent` construction/callback kwargs; `state.db` schema, sizes, counts,
WAL mode, FTS latency; the legacy UI's 335.61 MB duplicate store and its slow JSON parsing; the cron
`update_job` field passthrough and the specific jobs needing advanced fields; OpenViking v0.4.17.1 routes and
the behaviours in §5.5; the pod's container/mount/volume/service layout; the GitOps revision and repo paths.

**Not established — verify during the build, do not assume:**
- End-to-end perceived speedup on real workloads. Model and tool latency dominate and are unaffected.
- Behaviour of a turn when the pod is recreated mid-flight (it will be lost, as it is today — but confirm the
  transcript stays consistent).
- Exact `run_conversation` kwargs on this build (introspect at runtime).
- Whether an in-flight turn survives any process restart without a separate always-on worker.
- Cloudflare tunnel hostname/Access policy enforcement (managed remotely; not inspected).
- Backup/restore actually works (no restore test was performed; Longhorn replicas are redundancy, not backup).
- Live PVC `accessModes` and PV reclaim policy (read-only tooling did not expose them).

---

## 12. Reference material

Full read-only audit artifacts from the discovery work, useful as ground truth:

| File | Content |
|---|---|
| `runtime.md` | Hermes HTTP API surface, runs/SSE semantics, capabilities |
| `deployment.md` | Kubernetes/storage/cutover audit with Git blob receipts |
| `openviking.md` | Full OpenViking REST surface, contract pitfalls, security notes |
| `webui-baseline.md` | How the legacy UI implements each of the seven areas |
| `verdict.md` | Consolidated findings |
| `storage-benchmark.json`, `storage-benchmark2.json` | The measurements in §0 and §2 |
| `contract-summary.json`, `runtime.probes.json`, `openviking-receipts.json` | Sanitized live probe receipts |

A working reference implementation of the direct-import approach is on the live volume at
`/app/api/*.py` (MIT licensed, `nesquena/hermes-webui`). Reuse its guard logic freely; retain the license notice.
Do not reuse its storage model.

---

*End of specification.*

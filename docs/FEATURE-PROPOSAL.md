# Astra — Feature Proposal

**Status:** proposal for review. Nothing here overrides `BUILD-SPEC.md`; that document stays authoritative
for architecture, constraints and the build plan. This file only proposes *additions* on top of the seven
areas already specified (Chats, Scheduled tasks, Skills, Memories, Files, Insights, Logs).

**Derived from:** read-only aggregate analysis of the live `state.db` this UI will replace (5 weeks of real
single-user usage, 2026-08-11 → 2026-09-16), the legacy WebUI baseline audit, the Astra backend/frontend as
committed at `main`, and the recorded working preferences of the user. Redacted aggregates only — no message
content, no secrets, no tokens.

---

## 1. Evidence base

Every feature below cites a number from this section. If a feature has no citation, it is marked
**(judgement call)**.

### 1.1 Volume

| Metric | Value |
|---|---|
| Sessions by source | 204 `webui` · 146 `cron` · 38 `subagent` · 37 `cli` · 10 `discord` · 2 `tui` |
| Messages in `webui` sessions | 23,582 |
| Tool calls in `webui` sessions | 12,806 |
| Avg per `webui` session | 115.6 messages, 62.8 tool calls |
| Sessions >200 messages | 38 (89 >100 messages; 101 with >50 tool calls) |
| Largest session | 585 messages / 305 tool calls |
| User turns analysed | 1,653 — median 163 chars, p90 3,028 chars, max 103,210 chars |
| Estimated spend in window | $20.43 · 117.6M input tokens · 13.2M output tokens |

### 1.2 Tool mix (what the UI has to render)

`terminal` 7,132 · `read_file` 2,534 · `search_files` 1,853 · `execute_code` 1,150 · `skill_view` 1,122 ·
`patch` 999 · `write_file` 952 · `web_search` 895 · `web_extract` 470 · `process` 263 · `todo` 213 ·
`browser_exec` 190 · `cronjob` 181 · `session_search` 146 · `viking_search` 129 · `memory` 122 ·
`skill_manage` 122 · `delegate_task` 89 · `clarify` 52 · `vision_analyze` 28.

Also present in the DB: 13,170 assistant messages carry reasoning content; 13,134 carry tool calls.

### 1.3 Topic frequency across user turns (n=1,653)

infra/k8s 21% · repos & PRs 19% · memory 13% · scheduling 12% · cloudflare 12% · UI/UX 11% · tasks 10% ·
web research 10% · session history 10% · cost/tokens 9% · dependency PRs 9% · briefings 8% · wiki 8% ·
interrupt/stop 7% · food 7% · files/attachments 5% · skills 5% · approvals 5% · email 5% · mobile 3%.

### 1.4 Rhythms

- **Hour of day (local):** bimodal. Midday peak (12:00 → 154 turns) plus a heavy evening block
  (21:00–00:00 → 376 turns). Thu–Sun are lighter (183/194/96/213).
- **Scheduled work:** 9 active jobs, 146 cron sessions, 195 stored run outputs.
- **Delegation:** 89 `delegate_task` calls, 21 async delegation batches, 38 subagent sessions.
- **Interruption:** 52 `clarify` prompts (one session asked 5), 80 turns mentioning approvals.
- **Session state:** 0 pinned, 11 archived, 0 handoffs used.

---

## 2. What Astra already covers (so this list stays additive)

- **Nav/areas:** Chats · Scheduled tasks · Skills · Memories · Files · Insights · Logs.
- **Backend:** ~58 routes across sessions, chat (`send`/`steer`/`stop`/`approve`/`answer`/`stream`),
  cron (`run`/`pause`/`resume`/`patch`/`delete`/outputs), skills, memory, files (`upload`/`content`/`tree`),
  insights, logs, search, OpenViking inspector.
- **Already specified in BUILD-SPEC §5** and therefore *not* re-proposed here: virtualized transcript,
  coalesced streaming, approval/clarify inline components, reconnect resync, cron field parity, OpenViking
  inspector with its behavioural traps, file deny-wall, charts, log tailer.

The proposals below are grouped by the job the user is actually trying to do. Size tags: **S** ≈ under a day,
**M** ≈ a few days, **L** ≈ a week or more of focused work.

---

## 3. Group A — "Show me what it's doing right now"

The median session is 63 tool calls (evidence 1.1). Today the only view of that is a scrolling transcript.

- **A1. Live activity rail (S).** A right-hand strip showing the current turn in flight: active tool, elapsed
  time, target (file/host), and status. Feed from the existing SSE stream. *Evidence: 62.8 tool calls/session.*
- **A2. Receipts panel per turn (M).** Collapse a turn into "what actually happened": commands run, files
  written, URLs fetched, exit codes, diffs — with failed steps flagged. *Evidence: 7,132 terminal + 1,951
  write ops; the user's standing requirement is receipts over narration.*
- **A3. Session change-set with revert (M).** Aggregate every `patch`/`write_file` in a session into a diff
  list (`+/-` lines, per file) with per-file revert via git when the path is in a repo. *Evidence: 999 + 952
  calls in 5 weeks.*
- **A4. Tool-noise control (S).** Per-tool default display (hide / one-line / expanded) plus "show errors
  only" filter for the whole session. *Evidence: `terminal` alone is 65% of tool-call volume.*
- **A5. Server terminal pane (M).** A real shell view pinned to the workspace, not a scraped transcript — the
  legacy UI has a partial `terminal.js`. Read-only mode by default, write mode behind approval.
  *Evidence: 7,132 terminal calls.*
- **A6. Background process manager (M).** List long-running shells (builds, watchers, dev servers) with
  start time, tail of output, notify-on-exit state, and kill/close. *Evidence: 263 `process` calls; long
  builds are a recurring pattern.*
- **A7. Subagent & delegation monitor (L).** Live cards for delegated work: goal, elapsed, last tool, plus
  steer/stop, and a per-batch consolidated result view. *Evidence: 89 `delegate_task`, 21 async batches, 38
  subagent sessions — currently all invisible until the batch returns.*
- **A8. Delegation history page (S).** Past subagent runs with their transcripts and outcomes, filterable by
  parent session. *Evidence: delegation is frequent enough to have its own audit trail.*
- **A9. Reasoning controls (S).** Per-message expand/collapse, a global "hide thinking" default, and a
  copy-reasoning action. *Evidence: 13,170 messages carry reasoning.*
- **A10. Turn audit trail (M).** Append-only per-turn log of tool name, args digest, approval disposition,
  duration and result status, exportable. Answers "did you actually run it?" without scrolling.
  *Evidence: user's verification-first working style; 12,806 tool calls.*

## 4. Group B — "Get my attention, then get out of the way"

- **B1. Needs-you centre (M).** One place listing every pending clarify question and approval request across
  all sessions, with the choices rendered as buttons. *Evidence: 52 clarify prompts, up to 5 in one session.*
- **B2. While-you-were-away digest (S).** On connect, summarise: questions asked while you were gone, work
  finished, jobs that failed. *Evidence: 376 turns land in the 21:00–00:00 block and mobile use is real.*
- **B3. Approval policy editor (M).** Manage auto-approve/deny rules (command patterns, paths, tools) from the
  UI, with a dry-run against recent history. *Evidence: 80 turns touch approvals; the user prefers to approve
  changes rather than have them applied silently.*
- **B4. Survivable stop/steer (M).** Stop and steer from any client; if a steer was accepted but not consumed,
  the UI re-offers it as the next turn. *Evidence: 7% of turns are interrupt/stop; disconnect-during-work is a
  known legacy pain.*
- **B5. Push notifications (M).** Web-push for: needs-answer, turn finished, job failed, budget warning.
  *Evidence: 47 mobile mentions; "Hermex is so slow it's driving me crazy" came from phone use.*
- **B6. Notification routing (S).** Per-event-type routing to Discord / push / email / in-app only.
  *Evidence: Discord is a home channel and the existing delivery surface for cron output.*
- **B7. Cross-surface unified inbox (L).** Sessions are one DB shared with Discord, CLI and cron (10 / 37 / 146
  sessions respectively). Show them all, with a source chip, and allow replying to a Discord-originated
  session from the browser. *Evidence: 1.4 above.*
- **B8. Session handoff (M).** "Continue on my phone" / "continue in Discord" — the schema already has
  `handoff_state`/`handoff_platform`, currently unused (0 rows). *Evidence: 1.4.*

## 5. Group C — Composer and context ergonomics

- **C1. Large-paste handling (S).** Auto-convert pastes over ~4k chars into an attached file with a preview
  chip instead of dumping into the composer. *Evidence: p90 user turn is 3,028 chars, max 103,210.*
- **C2. Image paste and capture (S).** Clipboard paste, drag-drop, and phone camera capture → attach and
  auto-offer vision analysis. *Evidence: 28 `vision_analyze` calls.*
- **C3. Voice in, audio out (M).** Mic button for dictation on mobile; play a reply as audio. *Evidence:
  47 mobile mentions; TTS output already exists in the runtime.*
- **C4. Model + reasoning picker with cost hint (S).** Pick model/alias and reasoning effort in the composer,
  showing the last-known $/Mtok for the choice. *Evidence: 43 model-switch turns, 155 cost turns, 3 fallback
  providers configured and aliases already defined.*
- **C5. Workspace chip, not message text (M).** The client currently injects a workspace marker into the
  message body (visible in stored titles/turns). Make workspace a first-class field on the session: chip in
  the header, switcher in the composer, filter in the session list. *Evidence: marker text appears in stored
  titles and 448-message sessions lack real titles.*
- **C6. Live cost meter + budget guard (M).** Tokens and estimated $ per turn, per session, with a soft
  warning threshold and a hard stop option. *Evidence: 9% of turns mention cost; explicitly budget-conscious
  user; an in-cluster usage collector already exists for allowance data.*
- **C7. Prompt library (S).** Saved snippets/macros (e.g. "review this PR", "summarise these notes") with
  placeholders. *Evidence: repeated task shapes across 204 sessions.*
- **C8. Branch / edit-and-resend / regenerate (M).** Fork a conversation from any message, edit a user turn and
  resend, regenerate an assistant turn with a different model. *Evidence: 10% of turns are about session
  history and revisiting prior work; `rewind_count` already exists in the schema.*

## 6. Group D — "Remember what I asked and why you knew that"

- **D1. Search that covers everything (M).** One box over sessions, turns, tool output, memories and wiki
  pages, with filters (source, date, tool used, file touched). *Evidence: 146 `session_search` calls;
  the app already has an FTS index to build on.*
- **D2. Titles, tags, pin/archive done properly (S).** Auto-title with regeneration, manual rename, freeform
  tags, pin to top, archive with restore. *Evidence: 0 pinned / 11 archived / some sessions have no useful
  title despite an auxiliary title-generation model.*
- **D3. Session digest (S).** A one-screen "what we did here": outcome, files changed, decisions, open
  questions — without reading 585 messages. *Evidence: 38 sessions exceed 200 messages.*
- **D4. Recall inspector (M).** For any turn, show which memories/wiki pages/profile facts were recalled and
  injected, with source URI and score, plus a "this recall was wrong" flag. *Evidence: 13% of turns are
  memory-related; recall parameters are already configurable.*
- **D5. Memory proposal queue (M).** Pending memory writes appear as review cards: approve / edit / reject,
  with the exact text. *Evidence: 122 `memory` + 58 remember-style writes; the standing preference is to
  approve changes to memory before they apply.*
- **D6. Memory diff timeline (M).** Every edit to working-memory files with before/after and one-click revert.
  *Evidence: same preference; the legacy UI showed only current state.*
- **D7. Stale-memory review (M).** Surface contradictions, superseded facts and low-signal entries for
  forget/merge, fed by the existing maintenance jobs. *Evidence: 13% memory turns; two scheduled memory jobs
  already run.*
- **D8. Knowledge-graph browser (M).** Entities and relations with evidence links (a relation store already
  exists in the memory backend). *Evidence: 13% memory turns.*
- **D9. Wiki reader (S).** In-app browse/search of the workspace wiki with backlinks. *Evidence: 8% wiki/notes
  turns.*
- **D10. Skill usage analytics (S).** Which skills were loaded/edited, which never fire, cost per skill in
  prompt tokens. *Evidence: 1,122 `skill_view` vs 89 skill-related turns; every loaded description costs
  tokens per request.*
- **D11. Skill change proposals + curator (M).** Edit a skill as a proposal with a diff, apply/rollback, and
  expose curator restore for archived ones. *Evidence: 122 `skill_manage` calls; a curator exists and skills
  are already being disabled/consolidated.*

## 7. Group E — Scheduled work that behaves

- **E1. Run timeline + failure monitor (M).** Per job: run duration trend, last N statuses, silent/no-change
  markers, failure detail with output. *Evidence: 9 jobs, 146 cron sessions, 195 outputs.*
- **E2. Correct unread semantics (S).** Unread state belongs to a *job run* with explicit read tracking, not
  a session-wide Set that re-seeds on every silent run. *Evidence: documented legacy bug where a `*/5` watcher
  keeps the badge alive and only opening that job clears it.*
- **E3. Output diffing (S).** Diff today's run output against the previous one, highlighted. *Evidence: 8% of
  turns are briefings; run outputs are markdown snapshots.*
- **E4. Watcher inbox (M).** Jobs that exist to *notice* things (mail watcher, dependency-PR reviewer) get an
  event feed with read/unread, instead of only a Discord message. *Evidence: 2 of 9 jobs are watchers; watcher
  runs dominate cron session count.*
- **E5. Delivery preview + test send (S).** Show exactly where a job delivers and send a test payload.
  *Evidence: delivery targets include Discord and local; mis-routing is silent.*
- **E6. Next-run countdown + run-now with confirmation (S).** *Evidence: manual trigger already exists in the
  backend; make it visible and safe.*

## 8. Group F — Ops surface (21% of all turns mention infra)

Today every ops question costs a chat round-trip. Some of it should just be on screen.

- **F1. Ops board (L).** Live cluster cards from the existing read-only cluster MCP tools: ArgoCD app sync/
  health, firing alerts, per-node usage, PVC/Longhorn state, homelab service health. *Evidence: 21% infra
  turns; read-only homelab tools already wired and used (32+ ArgoCD calls, 31 workload-status calls).*
- **F2. Deep links out (S).** Grafana · ArgoCD · NetBox · router · Home Assistant · Cloudflare dashboards,
  context-aware from the current session's repo/host. *Evidence: 12% cloudflare + 3% home-assistant turns.*
- **F3. PR queue in-app (L).** Open PRs for the tracked repos with CI status, diff view, merge/comment
  actions, and "have the agent review this". *Evidence: 19% repo/PR turns, 9% dependency-PR turns, two
  scheduled PR-review jobs already running.*
- **F4. Project cohort switcher (M).** The workspace already holds per-project context files; expose the list
  with each project's open work and jump into a session pre-scoped to it. *Evidence: 19% repo turns, a
  scheduled project-context maintenance job.*
- **F5. Alert → incident thread (M).** Click a firing alert to open a session pre-loaded with the alert
  payload, relevant log tail and recent deploys. *Evidence: 21% infra turns; alerts are already collected by
  the monitoring stack.*

## 9. Group G — Artifacts and files

- **G1. Per-session artifact gallery (M).** Every file produced during a session, as cards, with inline
  preview. *Evidence: the standing preference is deliverables that render inline; a silently-failing link
  reads as "you stopped working".*
- **G2. HTML report preview (S).** Render generated HTML reports inline (sandboxed) and offer open-in-new-tab
  plus download. *Evidence: explicit preference — long reports should preview as rendered HTML, not raw
  markdown links.*
- **G3. Upload destination chip (S).** After upload, show the exact workspace path and make it copyable.
  *Evidence: file-operation turns are 5% of the total.*
- **G4. "Ask about this file" (M).** Right-click any file → start/extend a thread with it attached and the
  path in context. *Evidence: same.*
- **G5. Inline office/PDF preview (M).** Render `.docx`/`.xlsx`/`.pdf` in the viewer instead of forcing a
  download. *Evidence: document tooling is used regularly; 5% file turns.*
- **G6. Artifact share link (S).** Legacy had a `share.html`; keep an equivalent, scoped and revocable.
  *Evidence: parity.*

## 10. Group H — Trust, money, and cutover

- **H1. Cost & allowance dashboard (L).** Daily spend, per-model and per-provider breakdown, cache-hit rate,
  and allowance bars fed by the in-cluster usage collector; per-project attribution. *Evidence: 9% cost turns,
  budget-conscious user, collector already running.*
- **H2. Config change tracker (M).** Every change to agent config files with before/after, who/what triggered
  it, and rollback. *Evidence: 12+ config backups accumulated in 5 weeks.*
- **H3. Self-instrumentation banner (S).** Show session-list load time, transcript parse time and SSE lag in
  the UI itself. *Evidence: the whole reason for replacing the legacy UI is measured slowness (335 MB
  duplicate store, 21.4 ms per session parse).*
- **H4. Parity checklist page (S).** A live in-app status page: which legacy areas/features are done, partial
  or missing — the cutover decision becomes readable at a glance. *Evidence: cutover gate.*
- **H5. Export session (S).** Markdown/JSON export of a conversation, redacted on request. *Evidence: 10%
  session-history turns.*

## 11. Group I — Mobile, PWA and polish

- **I1. Installable PWA with offline transcript cache (M).** *Evidence: 47 mobile mentions; the legacy UI
  ships a manifest and service worker, and phone performance is the loudest complaint on record.*
- **I2. Command palette (S).** Jump to session, start a chat in a workspace, pause a job, search memory.
  *Evidence: keyboard-heavy desktop use, 204 sessions to navigate.*
- **I3. Keyboard shortcuts (S).** New chat, search, stop, expand-last-tool, jump-to-latest.
- **I4. Density + theme controls (S).** Dark default for the 21:00–00:00 block, comfortable/compact density,
  and per-message font size. *Evidence: hour-of-day distribution.*
- **I5. Quick actions on a session row (S).** Continue, rename, tag, pin, archive, duplicate, delete.
  *Evidence: pin/archive are currently unused, which usually means undiscoverable rather than unwanted.*

---

## 12. Suggested build order (highest value per unit of work)

1. **A1 + A2 + A4** — make long agent runs legible. Cheapest change with the biggest effect on the 63-call median session.
2. **B1 + B2** — needs-you centre and away digest. Removes the "what did I miss" tax on every reconnect.
3. **E2 + E1** — fix unread semantics, then give runs a timeline. The legacy badge bug is already diagnosed.
4. **C5 + C6 + D2** — workspace as a field, live cost, real titles. Cheap, high-touch, every-session wins.
5. **D4 + D5 + D6** — recall visibility and memory-write review. Directly serves the approve-before-apply
   working preference.
6. **A7 + A8** — delegation monitor. 89 delegations with no live view is the largest blind spot in the app.
7. **G1 + G2** — artifact gallery + HTML preview. Removes the "silently failed link" failure mode.
8. **F1 + F3** — ops board and PR queue. Turns the two largest topic clusters from chat round-trips into screens.

Themes to keep: no polling where a push will do (BUILD-SPEC §6), no new database, and nothing that puts
provider keys or secrets in the browser bundle.

---

## 13. Deliberately excluded

- Multi-user, sharing, teams, roles — single-user app.
- Agent-builder / marketplace / plugin-store surfaces.
- A second conversation store or any parallel session index.
- Editor features (full IDE, VSCode-in-browser). Files view plus deep links is the boundary.
- Anything that requires the agent to be reachable over a new public protocol for chat.

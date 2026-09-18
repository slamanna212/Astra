# Hermes WebUI → Astra feature parity checklist

Last audited: **2026-09-17**

This is a replacement-readiness checklist for [`nesquena/hermes-webui`](https://github.com/nesquena/hermes-webui), compared with the code currently in this repository. The upstream inventory is based primarily on its current [README](https://github.com/nesquena/hermes-webui/blob/master/README.md) and [feature-parity roadmap](https://github.com/nesquena/hermes-webui/blob/master/ROADMAP.md). It records shipped product behavior, not upstream's unimplemented “forward work.” Native wrapper apps are noted separately because they live in other repositories.

Legend:

- [x] Implemented in Astra
- [ ] Not found in Astra
- [ ] **Partial** — some useful behavior exists, but it does not match the complete upstream feature

“Implemented” means there is concrete backend/frontend code in this repository; it does not mean the feature has been verified against the production deployment. This is intentionally editable—check items off as they land and add links to the implementing PR or file.

## Chat and streaming

- [x] Send messages and receive SSE-streamed responses
- [x] Per-conversation model selection in the composer
- [x] Provider-grouped, searchable model picker
- [x] Use models/providers discovered from the active Hermes configuration
- [x] Live tool progress events and inline tool-call cards
- [x] Dangerous-command approval prompt: once, session, always, or deny
- [x] Blocking clarify questions with choice and free-text answers
- [x] Subagent activity events, transcript cards, and links to child sessions
- [x] Server-side running turn survives navigation and supports multiple/reconnecting subscribers
- [x] Persist and restore composer drafts in browser storage
- [x] Reconnect banner, extended 1.5–20 second backoff ladder, canonical-history polling, replay cursors, and session-scoped local partial-response recovery
- [x] Token count and estimated cost per session and message, plus a context-fill ring (provider-reported usage when available; clearly marked transcript estimates for legacy sessions)
- [x] Auto-compaction status UI plus streamed manual `/compact [focus]` (`/compress` alias and one-click composer control)
- [x] One-click focused-continuation recovery from exhausted context compression
- [x] `requestAnimationFrame`-throttled token/reasoning rendering
- [x] Stop/cancel a running turn
- [x] Reasoning-effort selector in chat
- [x] Configurable busy-turn mode (queue / interrupt / steer), with per-session persisted follow-up queues and stop-then-send interrupt behavior
- [x] Steer a running turn, including uploaded workspace-file references
- [x] Transparent chronological stream/worklog mode
- [x] Live tokens-per-second display

Local evidence: [`SessionPane.tsx`](frontend/src/pages/chats/SessionPane.tsx), [`LiveTurnActivity.tsx`](frontend/src/pages/chats/LiveTurnActivity.tsx), [`liveActivity.ts`](frontend/src/lib/liveActivity.ts), [`composerDrafts.ts`](frontend/src/lib/composerDrafts.ts), [`busyTurnQueue.ts`](frontend/src/lib/busyTurnQueue.ts), [`chatRecovery.ts`](frontend/src/lib/chatRecovery.ts), [`ChatComposer.tsx`](frontend/src/pages/chats/ChatComposer.tsx), [`chat.py`](backend/src/astra/chat.py), [`routes/chat.py`](backend/src/astra/routes/chat.py), and [`routes/sessions.py`](backend/src/astra/routes/sessions.py).

## Conversation controls and rendering

- [x] Copy an entire message to the clipboard
- [x] Regenerate/retry the last assistant response
- [x] Branch/fork a conversation from a selected message
- [x] In-progress text, reasoning, and tool/subagent activity recover from bounded browser storage; canonical completed messages remain authoritative
- [x] Render Markdown and GitHub-flavored tables
- [x] Syntax-highlight fenced code blocks
- [x] Code-block copy button with “Copied” feedback
- [x] Mermaid diagram rendering
- [x] KaTeX math rendering
- [x] Render Markdown image syntax and Hermes `MEDIA:` tokens inline
- [x] Safe rendering that does not execute raw response HTML
- [x] Collapsible reasoning/thinking blocks
- [x] Collapsible tool cards with arguments, result, and status
- [x] Message timestamps
- [x] Preserve/display truncation and compaction-summary markers

Local evidence: [`Transcript.tsx`](frontend/src/pages/chats/transcript/Transcript.tsx), [`ToolCallCard.tsx`](frontend/src/pages/chats/transcript/ToolCallCard.tsx), [`Markdown.tsx`](frontend/src/components/Markdown.tsx), and [`routes/media.py`](backend/src/astra/routes/media.py).

## Sessions and search

- [x] Create and load sessions
- [x] Delete sessions
- [x] Rename sessions
- [x] **Intentional low-cost equivalent** — Hermes titles the canonical session from its opening turn; periodic/adaptive re-titling is deliberately omitted to avoid additional model calls
- [x] Search session titles and full message content
- [x] Pin/star sessions to the top
- [x] Archive/unarchive sessions
- [x] Hide/unhide sessions
- [ ] Duplicate sessions
- [x] Export full session JSON
- [x] Download a Markdown transcript
- [x] Download a PDF transcript
- [ ] Session tags and tag filtering
- [ ] Session projects/folders and project filtering
- [x] Today / Yesterday / Earlier collapsible date groups
- [ ] Batch selection and bulk delete/move/archive
- [ ] Browser-tab title follows active session
- [x] **Equivalent/superior path** — CLI, gateway, cron, and other canonical Hermes sessions are read directly from `state.db`; no duplicate WebUI import is needed
- [x] Filter sessions by source and active/archived/hidden status
- [x] Show source badges and cross-channel sessions
- [x] Nest and navigate subagent child sessions
- [x] Paginate and virtualize large session lists/transcripts
- [ ] Per-session profile tracking and profile switching
- [ ] Per-session toolset override
- [ ] Fork a read-only cron session into an editable chat
- [ ] Cross-channel handoff dock and transcript-summary card
- [ ] Gateway route/failover metadata and model-switch warnings

Local evidence: [`SessionList.tsx`](frontend/src/pages/chats/SessionList.tsx), [`SessionPane.tsx`](frontend/src/pages/chats/SessionPane.tsx), [`conversationExport.ts`](frontend/src/lib/conversationExport.ts), [`SearchSpotlight.tsx`](frontend/src/components/SearchSpotlight.tsx), [`sessions.py`](backend/src/astra/sessions.py), [`search.py`](backend/src/astra/search.py), and [`messages.py`](backend/src/astra/messages.py).

## Workspace and files

- [ ] Add, remove, rename, or quick-switch among multiple workspaces
- [ ] New sessions inherit a user-selected last workspace
- [x] Browse the configured workspace by directory
- [ ] **Partial** — directories are paged with breadcrumbs, but there is no expandable lazy-loaded tree
- [x] Breadcrumb navigation
- [x] Preview text and source code
- [x] Render Markdown previews with tables and syntax highlighting
- [x] Preview common image formats inline
- [ ] **Partial** — PDF and other binaries can be opened/downloaded, but PDF, audio, video, Excalidraw, CSV, JSON, and YAML do not all have specialized inline viewers
- [ ] Edit files inline
- [ ] Create, rename, or delete files/folders
- [x] Click/drag-and-drop file upload
- [ ] Clipboard-paste upload
- [ ] Extract uploaded zip/tar archives
- [ ] Copy absolute/relative file paths
- [x] Close the active preview when navigating to another directory
- [ ] Resizable workspace preview panel
- [ ] Embedded workspace terminal
- [ ] Git branch and dirty-status badge
- [x] Download/open a workspace file
- [x] Refuse symlinks and guard workspace path traversal

Local evidence: [`FilesPage.tsx`](frontend/src/pages/files/FilesPage.tsx), [`FileBrowser.tsx`](frontend/src/pages/files/FileBrowser.tsx), [`FilePreview.tsx`](frontend/src/pages/files/FilePreview.tsx), and [`files.py`](backend/src/astra/files.py).

## Scheduled tasks / cron

- [x] List all jobs, including disabled jobs
- [x] View complete job details, schedule, status, failures, and last run
- [x] Create jobs
- [x] Edit jobs, including advanced Hermes fields
- [x] Run, pause, resume, and delete jobs
- [ ] **Partial** — skills can be entered as tags, but the form does not offer a picker populated from installed skills
- [ ] **Partial** — presets, raw expressions, and `every N` intervals exist, but there is no full time/day schedule builder
- [x] View paged run/output history and rendered output
- [x] Live job/status refresh over SSE
- [ ] Cron-completion toast/badge notification when the user is elsewhere in the app
- [ ] Dedicated live run “watch mode”
- [x] Edit script, post-script, monitor script/URL, workdir, context, continuity, model/provider, reasoning, repeat, and toolsets

Local evidence: [`CronForm.tsx`](frontend/src/pages/cron/CronForm.tsx), [`CronDetail.tsx`](frontend/src/pages/cron/CronDetail.tsx), [`CronOutputs.tsx`](frontend/src/pages/cron/CronOutputs.tsx), and [`routes/cron.py`](backend/src/astra/routes/cron.py).

## Skills

- [x] List skills grouped by category
- [x] Search/filter skills by name, description, and category
- [x] View rendered and raw `SKILL.md`
- [ ] **Partial** — the API returns supporting-file names, but the skill detail UI does not display/open them
- [x] Create, edit, and delete skills
- [x] Enable/disable skills
- [ ] `/skills` slash command

Local evidence: [`SkillList.tsx`](frontend/src/pages/skills/SkillList.tsx), [`SkillDetail.tsx`](frontend/src/pages/skills/SkillDetail.tsx), and [`skills_data.py`](backend/src/astra/skills_data.py).

## Memory

- [x] View and edit `MEMORY.md`
- [x] View and edit `USER.md`
- [x] View and edit `SOUL.md`
- [ ] Show last-modified timestamp for each working-memory file
- [x] Browse OpenViking indexed memory/resources
- [x] Fast and deep OpenViking search scoped to the actor
- [x] Show OpenViking health and operational status

Local evidence: [`MemoriesPage.tsx`](frontend/src/pages/memories/MemoriesPage.tsx), [`routes/memory.py`](backend/src/astra/routes/memory.py), and [`openviking.py`](backend/src/astra/openviking.py).

## Profiles, providers, and configuration

- [ ] Create, switch, clone, and delete Hermes profiles
- [ ] Profile picker with gateway/model/skill status
- [ ] Profile-local workspace/settings state
- [ ] Seamless profile switch without restart
- [ ] First-run onboarding wizard and provider configuration
- [ ] In-app OAuth for Codex and Claude
- [ ] Concurrent per-profile runtime isolation
- [ ] Configure providers, default model, default workspace, personality, and API endpoints
- [ ] Searchable settings
- [ ] Choose Enter vs Ctrl/Cmd+Enter send behavior
- [x] Light, dark, and system color modes
- [ ] Accent skins/theme gallery
- [x] Chat font-size setting
- [x] Desktop sidebar-collapse preference
- [x] System health/status screen

Local evidence: [`SettingsPage.tsx`](frontend/src/pages/settings/SettingsPage.tsx) and [`uiPreferences.ts`](frontend/src/lib/uiPreferences.ts).

## Notifications, commands, and auxiliary surfaces

- [ ] Background agent error banner
- [x] Approval-pending card in the active chat
- [ ] Provider/model mismatch warning
- [ ] Slash-command registry and autocomplete
- [ ] **Partial** — `/compact [focus]` and its `/compress` alias run locally; the other WebUI-local commands (`/help`, `/clear`, `/model`, `/workspace`, `/new`, `/usage`, `/theme`, `/queue`, `/interrupt`, `/steer`, `/goal`, `/btw`, `/reasoning`, `/skills`, and `/toolsets`) remain unimplemented
- [x] Usage/cost insights dashboard by date, model, provider, source, auxiliary task, and top session
- [x] Searchable/tailable agent, error, and gateway logs

Local evidence: [`InsightsPage.tsx`](frontend/src/pages/insights/InsightsPage.tsx), [`insights.py`](backend/src/astra/insights.py), [`LogsPage.tsx`](frontend/src/pages/logs/LogsPage.tsx), and [`logs.py`](backend/src/astra/logs.py).

## Authentication and security

- [x] Password login page
- [x] HMAC-signed HTTP-only session cookie
- [x] Secure and SameSite cookie controls
- [x] Strong password hashing (Astra uses scrypt; upstream documents PBKDF2)
- [x] Login rate limiting
- [x] CSRF guard on mutating API calls
- [x] Open-redirect guard on post-login redirect
- [ ] Optional authentication/off-by-default localhost mode
- [ ] Passkeys/WebAuthn and passwordless sign-in
- [ ] Native OIDC/PKCE login
- [ ] **Partial** — file responses set `nosniff` and unsafe HTML is not rendered, but global X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and a full CSP were not found
- [ ] Explicit global 20 MB request-body cap (file upload has its own size cap)
- [x] Session/path validation and sanitized client errors
- [x] Workspace and skill path-traversal defenses
- [x] Secrets stay server-side and sensitive settings are redacted
- [ ] Custom-provider SSRF protections (no custom-provider UI exists yet)

Local evidence: [`auth.py`](backend/src/astra/auth.py), [`middleware.py`](backend/src/astra/middleware.py), [`routes/auth.py`](backend/src/astra/routes/auth.py), and backend auth/files/skills tests.

## Visual UX, mobile, PWA, and accessibility

- [x] Responsive hamburger/sidebar navigation
- [x] Responsive master/detail layouts for chat, files, cron, and skills
- [ ] Dedicated files slide-over panel
- [ ] Audited 44 px minimum touch targets/container-query composer behavior
- [ ] PWA manifest, service worker, offline shell, and install flow
- [x] SVG favicon/brand mark
- [ ] Branded onboarding flow

Local evidence: [`AppLayout.tsx`](frontend/src/layout/AppLayout.tsx), responsive page CSS modules, and [`favicon.svg`](frontend/public/favicon.svg).

## MCP, extensions, and distribution

- [ ] MCP server management UI (add/edit/delete)
- [ ] Opt-in local extension loader
- [ ] One-click vetted extension gallery
- [ ] Extension themes, TTS engines, nav actions, sidecars, iframe tabs, settings, and owned storage
- [ ] Extension diagnostics and consented sidecar proxy
- [ ] Subpath/reverse-proxy mount support explicitly tested/documented
- [ ] Dockerfile/Compose packaging in this repository
- [ ] Multi-architecture GHCR release pipeline
- [ ] Nix package/NixOS module
- [ ] Native macOS/Windows/Linux/Android/iOS wrapper integrations (upstream wrappers are separate projects)

## Astra capabilities beyond the upstream checklist

These are not parity requirements, but they are important replacement advantages and should not be lost while closing gaps.

- [x] Treat Hermes `state.db` as the only conversation source—no duplicate JSON conversation store
- [x] Read canonical CLI, gateway, cron, and subagent sessions directly instead of importing copies
- [x] FTS-backed, paginated global search with source filters and direct message highlighting
- [x] Virtualized session, transcript, and file lists for large datasets
- [x] Dedicated cost/token insights, including auxiliary model tasks
- [x] OpenViking browser, search, and health/status inspector
- [x] Searchable live log viewer
- [x] Full advanced cron-field editing beyond the former app's earlier limited cron panel
- [x] React/TypeScript frontend, typed API models, route-level code splitting, and automated frontend/backend tests

## Suggested replacement gate

Before removing the linked app, decide which unchecked items are truly required for this deployment. At minimum, re-verify these checked critical paths against the mounted production Hermes version:

- [ ] Login/logout and cookie/CSRF behavior behind the production ingress
- [ ] Create, stream, clarify, approve, steer, stop, reconnect, and resume a chat
- [ ] Browse/search large canonical sessions and open the largest transcript
- [ ] Create/edit/run/pause/resume/delete cron jobs and inspect outputs
- [ ] Create/edit/toggle/delete a disposable skill
- [ ] Read/write the three working-memory files and query OpenViking
- [ ] Browse/preview/upload/download workspace files and confirm traversal/symlink protections
- [ ] Confirm insights and logs do not expose secrets
- [ ] Confirm mobile/responsive behavior on the devices used to access Hermes

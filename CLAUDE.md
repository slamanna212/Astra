# Astra

Web UI + backend replacing `nesquena/hermes-webui` for a single-user Hermes Agent deployment.
**`BUILD-SPEC.md` is authoritative** — read §3 (constraints), §6 (efficiency rules) and §10 (traps) before any work.

## Layout
- `backend/` — Python 3.12, FastAPI, managed with `uv`. Package name `astra` (`backend/src/astra/`). Entrypoint `astra.main:app`, port **9090**.
- `frontend/` — React + TypeScript + Vite + Mantine, TanStack Query/Virtual, React Router. **npm**. Vite dev server proxies `/api` → `http://127.0.0.1:9090`.
- `deploy/` — Dockerfile + k8s manifests (local only; nothing is applied to the cluster or pushed to HomelabArgoCD).
- `.github/workflows/` — build + push image to `ghcr.io/slamanna212/astra`.

## Local dev data (gitignored, never commit anything from `exampledata/`)
- `exampledata/hermes-home/` — sanitized real `HERMES_HOME` (config.yaml, cron/jobs.json + output/, skills/, memories/, SOUL.md, logs/) plus a copy of the real `state.db`. Use as `HERMES_HOME` in dev.
- `exampledata/hermes-ui-handoff/hermes-agent-src/` — Hermes v0.21.0 source. Put on `PYTHONPATH` in dev (`ASTRA_HERMES_SRC`); in the container it is already in the image.
- `exampledata/hermes-ui-handoff/fixture/state.db` — synthetic DB for fast tests (86 sessions, one 4,413-msg conversation). `real/state.db` = pristine real snapshot.
- `exampledata/hermes-ui-handoff/contract/hermes-api-contract.json` — introspected signatures. Trust over guesses.
- `exampledata/hermes-ui-handoff/audit/*.md` — audits referenced by the spec.
- `exampledata/hermes-webui/` — legacy UI source at deployed tag `exp-v0.52.264`. Spec line receipts (`/app/api/...`) map to `exampledata/hermes-webui/api/...`. Reuse guard logic (MIT, keep notice); never its storage model.

## Rules
- Never hardcode a HERMES_HOME path; derive everything from config (`HERMES_HOME` env).
- Never print/log/return secrets. `config.yaml` contains live tokens (e.g. MCP server env) — never send config.yaml raw to the browser or logs.
- Browser-facing SQLite reads: `file:...?mode=ro` URI. Never `immutable=1`. Writes only via `hermes_state.SessionDB`.
- Introspect columns/signatures; don't assume.
- Do not make real outbound calls to model providers, OpenViking, or MCP servers without explicit user approval.
- Git: commits go straight to `main`, authored by the user only. **No `Co-Authored-By` / Claude trailers.** Subagents do not commit; the orchestrator commits after verification.
- User will do visual design later: build a clean, modern, functional Mantine UI with default theme; don't invest in custom styling.

# Astra backend

FastAPI service (Python 3.12, `uv`) that reads Hermes' `state.db` directly. See `../BUILD-SPEC.md`.

## Run (dev)

```sh
cd backend
uv sync
# either put these in backend/.env (see .env.example) or pass them inline:
HERMES_HOME=../exampledata/hermes-home \
ASTRA_HERMES_SRC=../exampledata/hermes-ui-handoff/hermes-agent-src \
uv run uvicorn astra.main:app --port 9090 --reload
```

The Vite dev server proxies `/api` to `http://127.0.0.1:9090`. If `frontend/dist` exists
(or `ASTRA_STATIC_DIR`), the backend also serves the built SPA.

## Password hash

```sh
uv run python -m astra.hashpw                    # prompts twice, no echo
printf '%s\n' 'my password' | uv run python -m astra.hashpw   # from stdin
```

Put the output in `ASTRA_PASSWORD_HASH` (single-quote it in `.env`; it contains `$`).

## Tests and benchmark

```sh
uv run pytest                                              # uses exampledata/.../fixture/state.db
uv run python scripts/bench_sessions.py ../exampledata/hermes-home   # real 333 MB state.db
```

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `HERMES_HOME` | yes | — | Hermes data dir. Every Hermes path (`state.db`, `config.yaml`, `cron/`, `skills/`, `memories/`, `logs/`) is derived from it. |
| `ASTRA_PASSWORD_HASH` | yes | — | `scrypt$<n>$<r>$<p>$<salt>$<hash>` from `astra.hashpw`. Startup fails if unset/malformed. |
| `ASTRA_SESSION_SECRET` | yes | — | ≥ 32 chars; HMAC key for the session cookie. Rotating it logs everyone out. |
| `ASTRA_COOKIE_SECURE` | no | `true` | Set `false` only for plain-http local dev. |
| `ASTRA_HERMES_SRC` | no | — | Hermes source tree, prepended to `sys.path` (dev only; the Hermes image already has it). |
| `ASTRA_DATA_DIR` | no | `$HERMES_HOME/astra-ui` | UI-owned state (prefs). Never conversation data. Not created until something needs it. |
| `ASTRA_STATIC_DIR` | no | `<repo>/frontend/dist` | Built SPA. Set explicitly when the package is installed outside the repo (container). |
| `ASTRA_LOG_LEVEL` | no | `INFO` | JSON lines on stdout, secrets redacted. |

Real environment variables override `backend/.env`; relative paths in `.env` resolve against the `.env` file's directory.

## API (Phase 0)

All `/api/*` routes require the `astra_session` cookie except `GET /api/health`, `POST /api/auth/login`
and `POST /api/auth/logout`. Every `POST/PUT/PATCH/DELETE` under `/api` must send `X-Requested-With: astra`
(else 403).

- `GET /api/health` → `{status, version, state_db: {ok}}` (public, nothing else)
- `POST /api/auth/login` `{password}` → 204 + cookie (5 failures / 5 min per client IP → 429)
- `POST /api/auth/logout` → 204; `GET /api/auth/me` → 200 `{authenticated: true}` or 401
- `GET /api/status` → hermes_home/state.db/journal mode/session count/Hermes importable
- `GET /api/sessions?limit=&cursor=&source=&source=&include_archived=&include_hidden=&pinned_first=`
  → `{items, next_cursor}`; order `(pinned DESC, COALESCE(last_activity_at, started_at) DESC, id DESC)`,
  keyset cursor (bound to the filters it was issued for; mismatch → 400). Timestamps are epoch seconds.
- `GET /api/sessions/{id}` → summary + safe detail columns (no system prompt / model_config / origin / chat ids); 404 if missing.

## state.db access

Read-only `file:…?mode=ro` connections (never `immutable=1`) with `PRAGMA query_only=1`, pooled, used from
worker threads. Columns are introspected at startup and on "no such column". SQLite readers of a WAL database
touch the `-shm` file (and create `-wal`/`-shm` if absent) — that is SQLite's coordination, not a store;
`state.db` itself is never modified.

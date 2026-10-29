# Profiles (bots)

Astra serves every profile from the one process it already had. `/api/...` is the default
profile; `/api/profiles/<name>/...` is that profile's own `HERMES_HOME`, through the same routes,
dependencies and UI. Native Hermes state is the only store — `HERMES_HOME/profiles/<name>` plus
that profile's `profile.yaml`. Astra adds a title, description, section, picture and the canonical
Bot Chat, and nothing else.

## How a request finds its profile

`ProfilePathMiddleware` (pure ASGI, `backend/src/astra/middleware.py`) rewrites
`/api/profiles/<name>/<rest>` to `/api/<rest>` and puts `<name>` on the scope. It runs before
routing because FastAPI 0.141's included routers ignore path parameters in an
`include_router(prefix=...)`. `deps.get_ctx` reads that name and returns a cached `AppContext`
built with `Settings` whose `hermes_home` is that profile's directory, so every route derives its
paths from the right home with no route-level changes.

The registry of profiles lives at `/api/bots` — deliberately outside the profile namespace, so a
path can never mean both "a bot" and "a bot's data".

## What is shared and what is not

- Shared: the login, the session cookie, the CSRF guard, the rate limiter.
- Per profile: `Settings`, `StateDB`, `ChatManager` (including its agent cache), cron broadcaster,
  OpenViking client, terminal manager. Built lazily on first request, kept for the process.

`ChatManager._build_agent` calls `config.activate_hermes_home(home)` before constructing an agent,
which sets `os.environ["HERMES_HOME"]` and patches the two Hermes modules that snapshot paths at
import time (`cron.jobs`, `tools.skills_tool`). This is the same approach hermes-webui uses.

**Limit, stated plainly:** `HERMES_HOME` is process-global, so it is set per agent build, not per
request. Two bots taking a turn at the same instant can have the other's home in the environment
while Hermes' own internals read it. Astra's own reads are all per-context and unaffected. If that
ever matters, the fix is a worker process per profile — which is what this replaced.

## Presentation metadata

`profile.yaml`'s `ui_meta.hermes-bots` holds `title`, `hidden`, `section`. Every write records the
field it changed in `_ui_meta_revisions`, so a concurrent native write (a renamed profile) is
detected rather than silently overwritten. Avatars are `assets/avatar.<ext>` inside the profile
directory, magic-byte checked, 2 MB cap, no SVG.

## Canonical Bot Chat

Identity is the exact title `Bot Chat` in that profile's `state.db`; no client keeps a pointer.
`POST /api/bots/<name>/bot-chat` returns it, creating it on first use (`source=bot_peer_dm`,
`hidden`, `pinned`). Archiving it retires the row and the next open creates a fresh one — the
native "title is unique" rule is what makes that work.

## Frontend

The picker is in the composer: `frontend/src/components/BotPicker.tsx`. It lists every visible bot
with its picture and unread dot; choosing one loads that bot's document
(`/p/<name>/bots/chat`) rather than re-scoping the current one, so no cache, draft, queued turn or
open stream can follow it across. `/bots` is the roster (`pages/bots/BotsPage.tsx`), with the
editor, avatars and duplicate/delete in `BotEditor.tsx`.

## Tests

`backend/tests/test_profiles.py` — roster and path guards, two profiles served from one process
with separate homes, CRUD/`ui_meta`/avatar, and the canonical Bot Chat lifecycle.
Frontend: `BotPicker.test.tsx`, `BotsPage.test.tsx`, `ProfileGate.test.tsx`, `profiles.test.ts`,
`profileScope.test.ts`, `profileIsolation.test.ts`.

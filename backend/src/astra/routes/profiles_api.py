"""Profiles (bots): roster, CRUD, avatars and the canonical Bot Chat.

Every operation here is native Hermes state — ``HERMES_HOME/profiles/<name>`` plus the profile's
own ``profile.yaml``. Astra stores no separate agent database; it adds presentation (a title, a
description, a picture, a grouping) in ``profile.yaml``'s existing ``ui_meta`` block and keeps
per-field revisions so a concurrent native write is detected instead of silently overwritten.
"""

from __future__ import annotations

import anyio.to_thread
from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from astra.deps import Ctx, ProfileContexts
from astra.hermes_bridge import session_db_class
from astra.models import (
    BotChatResponse,
    ProfileCreateRequest,
    ProfileDetail,
    ProfileDuplicateRequest,
    ProfileList,
    ProfileModel,
    ProfileModelOptions,
    ProfileUpdateRequest,
)
from astra.profiles import (
    AVATAR_EXTS,
    MAX_AVATAR_BYTES,
    avatar_file,
    clear_avatar,
    create_profile,
    delete_profile,
    model_options,
    profile_home,
    profile_names,
    profile_soul,
    profile_view,
    store_avatar,
    update_profile,
)

router = APIRouter(prefix="/api/bots", tags=["profiles"])

CANONICAL_BOT_CHAT_TITLE = "Bot Chat"


def _root(ctx: Ctx):
    return ctx.settings.hermes_home


def _detail(Contexts_root, name: str, *, running: bool = False) -> ProfileDetail:
    view = profile_view(Contexts_root, name, running=running)
    home = profile_home(Contexts_root, name)
    return ProfileDetail(**view, soul=profile_soul(home))


def _contexts(ctx: Ctx) -> ProfileContexts:
    registry = ctx.profile_contexts
    if registry is None:  # pragma: no cover - create_app always sets it
        raise HTTPException(status_code=503, detail="Profile registry unavailable")
    return registry


async def _is_running(ctx: Ctx, name: str) -> bool:
    context = _contexts(ctx).loaded().get(name)
    chat = context.chat if context is not None else None
    if chat is None:
        return False
    turns = await chat.active_turns()
    return bool(turns)


@router.get("", response_model=ProfileList)
async def list_profiles(ctx: Ctx) -> ProfileList:
    root = _root(ctx)
    rows = []
    for name in profile_names(root):
        detail = profile_view(root, name)
        detail["running"] = await _is_running(ctx, name)
        rows.append(ProfileModel(**detail))
    return ProfileList(profiles=rows)


@router.post("", response_model=ProfileDetail, status_code=201)
async def add_profile(ctx: Ctx, body: ProfileCreateRequest) -> ProfileDetail:
    view = await anyio.to_thread.run_sync(
        lambda: create_profile(
            ctx.settings,
            name=body.name,
            clone_from=body.clone_from,
            title=body.title,
            description=body.description,
            soul=body.soul,
            model=body.model,
            provider=body.provider,
        )
    )
    return _detail(_root(ctx), view["name"])


@router.get("/{name}", response_model=ProfileDetail)
async def get_profile(ctx: Ctx, name: str) -> ProfileDetail:
    return _detail(_root(ctx), name, running=await _is_running(ctx, name))


@router.patch("/{name}", response_model=ProfileDetail)
async def patch_profile(ctx: Ctx, name: str, body: ProfileUpdateRequest) -> ProfileDetail:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return _detail(_root(ctx), name)
    await anyio.to_thread.run_sync(lambda: update_profile(ctx.settings, name, changes))
    if any(key in changes for key in ("model", "provider", "soul")):
        await _flush_idle_agents(ctx, name)
    return _detail(_root(ctx), name)


@router.post("/{name}/duplicate", response_model=ProfileDetail, status_code=201)
async def duplicate(ctx: Ctx, name: str, body: ProfileDuplicateRequest) -> ProfileDetail:
    profile_home(_root(ctx), name)
    view = await anyio.to_thread.run_sync(
        lambda: create_profile(ctx.settings, name=body.name, clone_from=name, title=body.title)
    )
    return _detail(_root(ctx), view["name"])


@router.delete("/{name}", status_code=204)
async def remove_profile(ctx: Ctx, name: str) -> Response:
    profile_home(_root(ctx), name)
    if await _is_running(ctx, name):
        raise HTTPException(status_code=409, detail="Stop this bot's running turn before deleting it")
    await _contexts(ctx).drop(name)
    await anyio.to_thread.run_sync(lambda: delete_profile(ctx.settings, name))
    return Response(status_code=204)


@router.get("/{name}/model-options", response_model=ProfileModelOptions)
async def profile_models(ctx: Ctx, name: str) -> ProfileModelOptions:
    home = profile_home(_root(ctx), name)
    return ProfileModelOptions(**await anyio.to_thread.run_sync(lambda: model_options(home)))


@router.get("/{name}/avatar")
async def get_avatar(ctx: Ctx, name: str) -> FileResponse:
    path = avatar_file(profile_home(_root(ctx), name))
    if path is None:
        raise HTTPException(status_code=404, detail="This bot has no avatar")
    return FileResponse(
        path,
        media_type=AVATAR_EXTS[path.suffix.lstrip(".")],
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{name}/avatar", response_model=ProfileDetail)
async def set_avatar(ctx: Ctx, name: str, file: UploadFile = File(...)) -> ProfileDetail:
    home = profile_home(_root(ctx), name)
    blob = await file.read(MAX_AVATAR_BYTES + 1)
    if len(blob) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be 2 MB or smaller")
    await anyio.to_thread.run_sync(lambda: store_avatar(home, blob))
    return _detail(_root(ctx), name)


@router.delete("/{name}/avatar", response_model=ProfileDetail)
async def remove_avatar(ctx: Ctx, name: str) -> ProfileDetail:
    home = profile_home(_root(ctx), name)
    await anyio.to_thread.run_sync(lambda: clear_avatar(home))
    return _detail(_root(ctx), name)


# --------------------------------------------------------------------------- Bot Chat


def _with_session_db(home, operation):
    db = session_db_class()(home)
    try:
        return operation(db)
    finally:
        close = getattr(db, "close", None)
        if callable(close):
            close()


def _ensure_canonical_bot_chat(context) -> tuple[str, bool]:
    """Return ``(session_id, created)`` for this profile's canonical Bot Chat.

    Identity is the exact title (native contract): no client keeps a pointer. Title is set
    first, because that is what retires an archived canonical row's title — the reason
    "archive it, then open the bot again" yields a fresh conversation. Then hidden, then
    pinned (pinning exempts an already-canonical row from the hidden-clearing rule).
    """
    from uuid import uuid4

    def _ensure(db):
        existing = db.get_session_by_title(CANONICAL_BOT_CHAT_TITLE)
        if existing and not existing.get("archived"):
            return str(existing["id"]), False
        session_id = str(uuid4())
        db.create_session(session_id, "bot_peer_dm", cwd=str(context.settings.workspace_dir))
        try:
            db.set_session_title(session_id, CANONICAL_BOT_CHAT_TITLE)
            db.set_session_hidden(session_id, True)
            db.set_session_pinned(session_id, True)
        except Exception:
            try:
                db.delete_session(session_id)
            except Exception:
                pass
            raise
        return session_id, True

    return _with_session_db(context.settings.paths.state_db, _ensure)


async def _bot_chat(ctx: Ctx, name: str) -> tuple[str, bool]:
    profile_home(_root(ctx), name)
    context = _contexts(ctx).get(name)
    try:
        return await anyio.to_thread.run_sync(_ensure_canonical_bot_chat, context)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/{name}/bot-chat", response_model=BotChatResponse)
async def bot_chat(ctx: Ctx, name: str) -> BotChatResponse:
    session_id, created = await _bot_chat(ctx, name)
    return BotChatResponse(session_id=session_id, created=created)


@router.post("/{name}/read", status_code=204)
async def mark_read(ctx: Ctx, name: str) -> Response:
    session_id, _created = await _bot_chat(ctx, name)
    context = _contexts(ctx).get(name)

    def _read(db):
        return db.set_session_read(session_id, True)

    await anyio.to_thread.run_sync(
        lambda: _with_session_db(context.settings.paths.state_db, _read)
    )
    return Response(status_code=204)


async def _flush_idle_agents(ctx: Ctx, name: str) -> None:
    """A profile edit must reach the next turn, so drop cached idle agents."""
    context = _contexts(ctx).loaded().get(name)
    if context is None or context.chat is None:
        return
    await context.chat.commit_idle()

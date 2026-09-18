from __future__ import annotations

import asyncio
from typing import Annotated
from uuid import uuid4

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Query

from astra.deps import Ctx
from astra.hermes_bridge import session_db_class
from astra.models import (
    SessionCount,
    SessionCreateRequest,
    SessionDetail,
    SessionForkRequest,
    SessionPage,
    SessionUpdateRequest,
)
from astra.sessions import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    InvalidCursor,
    ListParams,
    SessionStatus,
    count_sessions_by_status,
    get_session,
    list_sessions,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _with_session_db(ctx: Ctx, operation):
    """Run one canonical Hermes SessionDB write and always release its connection."""
    db = session_db_class()(ctx.settings.paths.state_db)
    try:
        return operation(db)
    finally:
        close = getattr(db, "close", None)
        if callable(close):
            close()


@router.get("", response_model=SessionPage)
async def sessions_list(
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    source: Annotated[list[str] | None, Query()] = None,
    status: SessionStatus = "active",
    pinned_first: bool = True,
) -> SessionPage:
    if source is not None and len(source) > 32:
        raise HTTPException(status_code=422, detail="too many source filters")
    params = ListParams(
        limit=limit,
        cursor=cursor or None,
        sources=tuple(dict.fromkeys(s for s in (source or []) if s)),
        status=status,
        pinned_first=pinned_first,
    )
    try:
        items, next_cursor = await ctx.db.run_with_schema(
            lambda conn, schema: list_sessions(conn, schema, params)
        )
    except InvalidCursor as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return SessionPage(items=items, next_cursor=next_cursor)


@router.get("/count", response_model=SessionCount)
async def sessions_count(
    ctx: Ctx,
    source: Annotated[list[str] | None, Query()] = None,
    status: SessionStatus = "archived",
) -> SessionCount:
    if source is not None and len(source) > 32:
        raise HTTPException(status_code=422, detail="too many source filters")
    sources = tuple(dict.fromkeys(s for s in (source or []) if s))
    count = await ctx.db.run_with_schema(
        lambda conn, schema: count_sessions_by_status(conn, schema, status, sources)
    )
    return SessionCount(count=count)


@router.post("", response_model=SessionDetail, status_code=201)
async def session_create(body: SessionCreateRequest, ctx: Ctx) -> SessionDetail:
    session_id = str(uuid4())

    def _create(db):
        kwargs = {"model": body.model} if body.model else {}
        db.create_session(session_id, "webui", **kwargs)
        try:
            if body.title is not None and not db.set_session_title(session_id, body.title):
                raise RuntimeError("new session disappeared during creation")
        except Exception:
            # Do not strand an untitled empty row when title validation/uniqueness fails.
            db.delete_session(session_id)
            raise

    try:
        await anyio.to_thread.run_sync(_with_session_db, ctx, _create)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, session_id))
    if detail is None:
        raise HTTPException(status_code=500, detail="Session creation was not persisted")
    # Starting a new conversation is a memory boundary for cached, inactive agents. The
    # potentially multi-second OpenViking commit must never delay this request.
    asyncio.create_task(ctx.chat.commit_idle(), name="chat-memory-boundary")
    return detail


@router.get("/{session_id}", response_model=SessionDetail)
async def session_detail(session_id: str, ctx: Ctx) -> SessionDetail:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, session_id))
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@router.post("/{session_id}/fork", response_model=SessionDetail, status_code=201)
async def session_fork(session_id: str, body: SessionForkRequest, ctx: Ctx) -> SessionDetail:
    """Create a child conversation containing the active transcript through one message."""
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    if await ctx.chat.is_running(session_id):
        raise HTTPException(status_code=409, detail="Stop the active turn before forking this conversation")
    fork_id = str(uuid4())

    def _fork(db):
        source = db.get_session(session_id)
        if source is None:
            return False
        messages = db.get_messages(session_id, include_compacted=True)
        selected: list[dict] = []
        found = False
        for message in messages:
            selected.append(message)
            if int(message.get("id", -1)) == body.message_id:
                found = True
                break
        if not found:
            raise ValueError("Message not found in the active conversation")
        db.create_session(
            fork_id,
            "webui",
            model=source.get("model"),
            system_prompt=source.get("system_prompt"),
            parent_session_id=session_id,
        )
        try:
            db.replace_messages(fork_id, selected)
            base_title = source.get("title") or source.get("display_name") or "Conversation"
            title = (
                db.get_next_title_in_lineage(base_title)
                if callable(getattr(db, "get_next_title_in_lineage", None))
                else f"{base_title} (fork)"
            )
            db.set_session_title(fork_id, title)
        except Exception:
            db.delete_session(fork_id)
            raise
        return True

    try:
        found = await anyio.to_thread.run_sync(_with_session_db, ctx, _fork)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, fork_id))
    if detail is None:
        raise HTTPException(status_code=500, detail="Fork was not persisted")
    return detail


@router.post("/{session_id}/recover-context", response_model=SessionDetail, status_code=201)
async def recover_context(session_id: str, ctx: Ctx) -> SessionDetail:
    """Start an empty, focused continuation after context compression is exhausted."""
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    if await ctx.chat.is_running(session_id):
        raise HTTPException(status_code=409, detail="Wait for the active turn to finish")
    if not ctx.chat.recovery_available(session_id):
        raise HTTPException(status_code=409, detail="Context recovery is no longer available")
    continuation_id = str(uuid4())

    def _recover(db):
        source = db.get_session(session_id)
        if source is None:
            return False
        db.create_session(
            continuation_id,
            "webui",
            model=source.get("model"),
            system_prompt=source.get("system_prompt"),
            parent_session_id=session_id,
        )
        try:
            title = source.get("title") or source.get("display_name") or "Conversation"
            db.set_session_title(continuation_id, f"{title} (focused continuation)")
        except Exception:
            db.delete_session(continuation_id)
            raise
        return True

    try:
        found = await anyio.to_thread.run_sync(_with_session_db, ctx, _recover)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    ctx.chat.consume_recovery(session_id)
    detail = await ctx.db.run_with_schema(
        lambda conn, schema: get_session(conn, schema, continuation_id)
    )
    if detail is None:
        raise HTTPException(status_code=500, detail="Focused continuation was not persisted")
    return detail


@router.patch("/{session_id}", response_model=SessionDetail)
async def session_update(session_id: str, body: SessionUpdateRequest, ctx: Ctx) -> SessionDetail:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, session_id))
        if detail is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return detail

    def _update(db):
        setters = {
            "title": db.set_session_title,
            "pinned": db.set_session_pinned,
            "archived": db.set_session_archived,
            "hidden": db.set_session_hidden,
        }
        return all(setters[key](session_id, value) for key, value in updates.items())

    try:
        found = await anyio.to_thread.run_sync(_with_session_db, ctx, _update)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, session_id))
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@router.delete("/{session_id}", status_code=204)
async def session_delete(session_id: str, ctx: Ctx) -> None:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    if await ctx.chat.is_running(session_id):
        raise HTTPException(status_code=409, detail="Stop the active turn before deleting this session")
    deleted = await anyio.to_thread.run_sync(
        _with_session_db, ctx, lambda db: db.delete_session(session_id)
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")

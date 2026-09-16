from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from astra.deps import Ctx
from astra.messages import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MessageNotFound,
    SessionNotFound,
    WindowParams,
    get_message,
    get_window,
    list_child_sessions,
)
from astra.models import ChildSessionsResponse, Message, MessagePage

router = APIRouter(prefix="/api/sessions", tags=["messages"])


@router.get("/{session_id}/messages", response_model=MessagePage)
async def messages_window(
    session_id: str,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    before_id: Annotated[int | None, Query(ge=0)] = None,
    # after_id=0 is the idiomatic "from the very start" keyset seek (ids are positive), so the
    # lower bound is 0, not 1.
    after_id: Annotated[int | None, Query(ge=0)] = None,
    around_id: Annotated[int | None, Query(ge=1)] = None,
    include_inactive: bool = False,
) -> MessagePage:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    if sum(x is not None for x in (before_id, after_id, around_id)) > 1:
        raise HTTPException(
            status_code=422, detail="only one of before_id, after_id, around_id may be set"
        )
    params = WindowParams(
        limit=limit,
        before_id=before_id,
        after_id=after_id,
        around_id=around_id,
        include_inactive=include_inactive,
    )
    try:
        return await ctx.db.run_with_schema(
            lambda conn, schema: get_window(conn, schema, session_id, params)
        )
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    except MessageNotFound:
        raise HTTPException(status_code=404, detail="Message not found") from None


@router.get("/{session_id}/children", response_model=ChildSessionsResponse)
async def session_children(session_id: str, ctx: Ctx) -> ChildSessionsResponse:
    """Sessions delegated from this one. Best-effort (see ``list_child_sessions``); never 404s
    even for an unknown session id, since it is only ever used to decorate an already-loaded
    transcript and an empty list is a harmless answer."""
    items = await ctx.db.run_with_schema(
        lambda conn, schema: list_child_sessions(conn, schema, session_id)
    )
    return ChildSessionsResponse(items=items)


@router.get("/{session_id}/messages/{message_id}", response_model=Message)
async def message_detail(session_id: str, message_id: int, ctx: Ctx) -> Message:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        return await ctx.db.run_with_schema(
            lambda conn, schema: get_message(conn, schema, session_id, message_id)
        )
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="Session not found") from None
    except MessageNotFound:
        raise HTTPException(status_code=404, detail="Message not found") from None

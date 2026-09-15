from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from astra.deps import Ctx
from astra.models import SessionDetail, SessionPage
from astra.sessions import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    InvalidCursor,
    ListParams,
    get_session,
    list_sessions,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=SessionPage)
async def sessions_list(
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    source: Annotated[list[str] | None, Query()] = None,
    include_archived: bool = False,
    include_hidden: bool = False,
    pinned_first: bool = True,
) -> SessionPage:
    if source is not None and len(source) > 32:
        raise HTTPException(status_code=422, detail="too many source filters")
    params = ListParams(
        limit=limit,
        cursor=cursor or None,
        sources=tuple(dict.fromkeys(s for s in (source or []) if s)),
        include_archived=include_archived,
        include_hidden=include_hidden,
        pinned_first=pinned_first,
    )
    try:
        items, next_cursor = await ctx.db.run_with_schema(
            lambda conn, schema: list_sessions(conn, schema, params)
        )
    except InvalidCursor as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return SessionPage(items=items, next_cursor=next_cursor)


@router.get("/{session_id}", response_model=SessionDetail)
async def session_detail(session_id: str, ctx: Ctx) -> SessionDetail:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    detail = await ctx.db.run_with_schema(lambda conn, schema: get_session(conn, schema, session_id))
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail

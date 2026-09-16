from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from astra.deps import Ctx
from astra.models import SearchPage
from astra.search import DEFAULT_LIMIT, MAX_LIMIT, InvalidSearchCursor, SearchParams, search_messages

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchPage)
async def search(
    ctx: Ctx,
    q: Annotated[str, Query(max_length=512)] = "",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    source: Annotated[list[str] | None, Query()] = None,
) -> SearchPage:
    if source is not None and len(source) > 32:
        raise HTTPException(status_code=422, detail="too many source filters")
    params = SearchParams(
        q=q,
        limit=limit,
        cursor=cursor or None,
        sources=tuple(dict.fromkeys(s for s in (source or []) if s)),
    )
    try:
        return await ctx.db.run_with_schema(
            lambda conn, schema: search_messages(conn, schema, params)
        )
    except InvalidSearchCursor as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

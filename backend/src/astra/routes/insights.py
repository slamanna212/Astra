from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from astra.deps import Ctx
from astra.insights import ALLOWED_DAYS, InvalidTimezone, build_insights
from astra.models import InsightsResponse

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("", response_model=InsightsResponse)
async def get_insights(
    ctx: Ctx,
    days: Annotated[str, Query()] = "30",
    tz: Annotated[str, Query(max_length=64)] = "UTC",
) -> InsightsResponse:
    if days not in ALLOWED_DAYS:
        raise HTTPException(
            status_code=422, detail=f"days must be one of {', '.join(ALLOWED_DAYS)}"
        )
    try:
        return await ctx.db.run_with_schema(
            lambda conn, schema: build_insights(conn, schema, days=days, tz=tz)
        )
    except InvalidTimezone as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

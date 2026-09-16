"""Safe read-only OpenViking inspector routes (BUILD-SPEC §5.5)."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from astra.deps import Ctx
from astra.openviking import OpenVikingUnavailable

router = APIRouter(prefix="/api/openviking", tags=["openviking"])

class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    mode: Literal["fast", "deep"] = "fast"
    target_uri: str | None = Field(default=None, max_length=2000)
    limit: int = Field(default=20, ge=1, le=100)
    query_expansion: Literal["off", "auto"] = "off"

def _uri(uri: str) -> str:
    if not uri.startswith("viking://") or len(uri) > 2000: raise HTTPException(400, "Invalid OpenViking URI")
    return uri

async def _call(ctx: Ctx, method: str, path: str, **kwargs: Any) -> Any:
    try: return await ctx.openviking.request(method, path, **kwargs)  # type: ignore[union-attr]
    except OpenVikingUnavailable as exc: raise HTTPException(503, str(exc)) from None
    except ValueError as exc: raise HTTPException(502, str(exc)) from None

@router.get("/health")
async def health(ctx: Ctx):
    health_data = await _call(ctx, "GET", "/health", auth=False)
    system = await _call(ctx, "GET", "/api/v1/observer/system")
    return {"reachable": True, "health": health_data, "system": system}

@router.get("/tree")
async def tree(ctx: Ctx, uri: str = Query("viking://")):
    result = await _call(ctx, "GET", "/api/v1/fs/ls", params={"uri": _uri(uri), "show_all_hidden": True, "recursive": False, "output": "agent", "abs_limit": 256})
    return {"uri": uri, "items": result if isinstance(result, list) else result.get("items", result)}

@router.get("/stat")
async def stat(ctx: Ctx, uri: str):
    return await _call(ctx, "GET", "/api/v1/fs/stat", params={"uri": _uri(uri)})

@router.get("/content")
async def content(ctx: Ctx, uri: str, offset: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=5000)):
    uri = _uri(uri)
    abstract = await _call(ctx, "GET", "/api/v1/content/abstract", params={"uri": uri})
    overview = await _call(ctx, "GET", "/api/v1/content/overview", params={"uri": uri})
    text = await _call(ctx, "GET", "/api/v1/content/read", params={"uri": uri, "offset": offset, "limit": limit})
    return {"uri": uri, "abstract": abstract, "overview": overview, "content": text, "offset": offset, "limit": limit}

@router.post("/search")
async def search(body: SearchRequest, ctx: Ctx):
    if body.mode == "fast":
        payload: dict[str, Any] = {"query": body.query, "limit": body.limit, "peer_scope": "actor"}
        if body.target_uri: payload["target_uri"] = _uri(body.target_uri)
        result = await _call(ctx, "POST", "/api/v1/search/find", body=payload)
    else:
        result = await _call(ctx, "POST", "/api/v1/search/search", body={"query": body.query, "mode": "context", "query_expansion": body.query_expansion, "max_tokens": 4000, "peer_scope": "actor"})
    return {"mode": body.mode, "result": result}

@router.get("/status")
async def status(ctx: Ctx):
    paths = {"system": "/api/v1/observer/system", "queue": "/api/v1/observer/queue", "lock": "/api/v1/observer/lock", "vikingdb": "/api/v1/observer/vikingdb", "models": "/api/v1/observer/models", "retrieval": "/api/v1/observer/retrieval", "memories": "/api/v1/stats/memories", "tasks": "/api/v1/tasks"}
    result: dict[str, Any] = {}
    for key, path in paths.items():
        result[key] = await _call(ctx, "GET", path, params={"limit": 20} if key == "tasks" else None)
    return {"reachable": True, **result}

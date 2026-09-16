"""Authenticated direct-Hermes chat routes. No call is made to port 8642."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from astra.chat import ChatError, NoActiveTurn, SessionBusy
from astra.deps import Ctx
from astra.models import ChatAnswerRequest, ChatSendRequest, ChatSteerRequest, ChatTurnStarted

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/{session_id}/send", response_model=ChatTurnStarted, status_code=202)
async def send(session_id: str, body: ChatSendRequest, ctx: Ctx) -> ChatTurnStarted:
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    # Do not start an expensive provider turn for an unknown canonical session.
    exists = await ctx.db.run(lambda conn: conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is not None)
    if not exists:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        await ctx.chat.start(session_id, body.message, model=body.model, provider=body.provider)
    except SessionBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ChatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return ChatTurnStarted()


@router.get("/{session_id}/stream")
async def stream(session_id: str, request: Request, ctx: Ctx) -> StreamingResponse:
    async def event_source():
        subscriber = await ctx.chat.subscribe(session_id)
        if subscriber is None:
            yield "event: idle\ndata: {}\n\n"
            return
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(subscriber.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {event.name}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"
                if event.name in {"done", "cancel", "error"}:
                    return
        finally:
            await ctx.chat.unsubscribe(session_id, subscriber)

    return StreamingResponse(event_source(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


@router.post("/{session_id}/stop", status_code=204)
async def stop(session_id: str, ctx: Ctx) -> None:
    if not await ctx.chat.stop(session_id):
        raise HTTPException(status_code=409, detail="no turn is running for this session")


@router.post("/{session_id}/steer", status_code=204)
async def steer(session_id: str, body: ChatSteerRequest, ctx: Ctx) -> None:
    try:
        accepted = await ctx.chat.steer(session_id, body.text)
    except NoActiveTurn as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ChatError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not accepted:
        raise HTTPException(status_code=422, detail="steer was not accepted")


@router.post("/{session_id}/answer", status_code=204)
async def answer(session_id: str, body: ChatAnswerRequest, ctx: Ctx) -> None:
    try:
        accepted = await ctx.chat.answer(session_id, body.question_id, body.answer)
    except NoActiveTurn as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not accepted:
        raise HTTPException(status_code=409, detail="clarify question is no longer pending")

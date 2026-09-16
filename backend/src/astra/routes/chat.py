"""Authenticated direct-Hermes chat routes. No call is made to port 8642."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from astra.chat import ChatError, NoActiveTurn, SessionBusy, _load_chat_config
from astra.deps import Ctx
from astra.models import (
    ChatAnswerRequest,
    ChatApprovalRequest,
    ChatOptions,
    ChatSendRequest,
    ChatState,
    ChatSteerRequest,
    ChatTurnStarted,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/{session_id}/state", response_model=ChatState)
async def state(session_id: str, ctx: Ctx) -> ChatState:
    exists = await ctx.db.run(
        lambda conn: conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is not None
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Session not found")
    return ChatState(running=await ctx.chat.is_running(session_id))


@router.get("/{session_id}/options", response_model=ChatOptions)
async def options(session_id: str, ctx: Ctx) -> ChatOptions:
    config = await asyncio.to_thread(_load_chat_config, ctx.settings.paths.config_yaml)
    model_config = config.get("model") if isinstance(config.get("model"), dict) else {}
    default_model = model_config.get("default") if isinstance(model_config.get("default"), str) else None
    default_provider = model_config.get("provider") if isinstance(model_config.get("provider"), str) else None

    def recent_values(conn):
        row = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        models = [r[0] for r in conn.execute(
            "SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL AND model != '' ORDER BY last_activity_at DESC LIMIT 30"
        )]
        providers = [r[0] for r in conn.execute(
            "SELECT DISTINCT billing_provider FROM sessions WHERE billing_provider IS NOT NULL AND billing_provider != '' ORDER BY last_activity_at DESC LIMIT 20"
        )]
        return models, providers

    values = await ctx.db.run(recent_values)
    if values is None:
        raise HTTPException(status_code=404, detail="Session not found")
    models, providers = values
    aliases = model_config.get("aliases")
    if isinstance(aliases, dict):
        models.extend(str(alias) for alias in aliases if isinstance(alias, str) and alias)
    fallbacks = config.get("fallback_providers")
    if isinstance(fallbacks, list):
        for fallback in fallbacks:
            if not isinstance(fallback, dict):
                continue
            fallback_model = fallback.get("model")
            fallback_provider = fallback.get("provider")
            if isinstance(fallback_model, str) and fallback_model:
                models.append(fallback_model)
            if isinstance(fallback_provider, str) and fallback_provider:
                providers.append(fallback_provider)
    if default_model and default_model not in models:
        models.insert(0, default_model)
    if default_provider and default_provider not in providers:
        providers.insert(0, default_provider)
    models = list(dict.fromkeys(models))
    providers = list(dict.fromkeys(providers))
    return ChatOptions(
        default_model=default_model,
        default_provider=default_provider,
        models=models,
        providers=providers,
    )


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
    if len(session_id) > 256:
        raise HTTPException(status_code=404, detail="Session not found")
    exists = await ctx.db.run(
        lambda conn: conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is not None
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_source():
        raw_last_id = request.headers.get("last-event-id", "0")
        try:
            after_seq = max(0, int(raw_last_id))
        except ValueError:
            after_seq = 0
        subscriber, running = await ctx.chat.subscribe(session_id, after_seq=after_seq)
        try:
            yield ": connected\n\n"
            yield f"event: state\ndata: {json.dumps({'running': running})}\n\n"
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(subscriber.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield f"id: {event.seq}\nevent: {event.name}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"
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


@router.post("/{session_id}/approve", status_code=204)
async def approve(session_id: str, body: ChatApprovalRequest, ctx: Ctx) -> None:
    try:
        accepted = await ctx.chat.approve(session_id, body.request_id, body.choice, body.reason)
    except NoActiveTurn as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not accepted:
        raise HTTPException(status_code=409, detail="approval request is no longer pending")

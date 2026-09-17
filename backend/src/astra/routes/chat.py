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
    ChatModelOption,
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
        model_rows = conn.execute(
            "SELECT DISTINCT model, billing_provider FROM sessions"
            " WHERE model IS NOT NULL AND model != ''"
            " ORDER BY last_activity_at DESC LIMIT 30"
        ).fetchall()
        providers = [r[0] for r in conn.execute(
            "SELECT DISTINCT billing_provider FROM sessions WHERE billing_provider IS NOT NULL AND billing_provider != '' ORDER BY last_activity_at DESC LIMIT 20"
        )]
        return model_rows, providers

    values = await ctx.db.run(recent_values)
    if values is None:
        raise HTTPException(status_code=404, detail="Session not found")
    model_rows, providers = values

    # `model` and `billing_provider` are independent columns; pairing distinct rows recovers the
    # actual provider a model was billed under last, rather than guessing from the model name.
    model_names: list[str] = []
    provider_for: dict[str, str | None] = {}
    for model_name, billing_provider in model_rows:
        if model_name not in provider_for:
            model_names.append(model_name)
            provider_for[model_name] = billing_provider or None

    aliases = model_config.get("aliases")
    if isinstance(aliases, dict):
        for alias_name, alias_target in aliases.items():
            if not isinstance(alias_name, str) or not alias_name:
                continue
            if alias_name not in provider_for:
                model_names.append(alias_name)
            # Alias values are "<provider>/<model>" (the model id itself may contain "/").
            if isinstance(alias_target, str) and "/" in alias_target:
                provider_for[alias_name] = alias_target.split("/", 1)[0]
            else:
                provider_for.setdefault(alias_name, None)

    fallbacks = config.get("fallback_providers")
    if isinstance(fallbacks, list):
        for fallback in fallbacks:
            if not isinstance(fallback, dict):
                continue
            fallback_model = fallback.get("model")
            fallback_provider = fallback.get("provider")
            if isinstance(fallback_model, str) and fallback_model:
                if fallback_model not in provider_for:
                    model_names.append(fallback_model)
                if isinstance(fallback_provider, str) and fallback_provider:
                    provider_for[fallback_model] = fallback_provider
                else:
                    provider_for.setdefault(fallback_model, None)
            if isinstance(fallback_provider, str) and fallback_provider:
                providers.append(fallback_provider)

    if default_model:
        if default_model not in provider_for:
            model_names.insert(0, default_model)
            provider_for[default_model] = default_provider
        elif default_provider:
            provider_for[default_model] = default_provider
    if default_provider and default_provider not in providers:
        providers.insert(0, default_provider)
    # Every provider a model actually resolved to must have a group to render into.
    providers.extend(p for p in provider_for.values() if p)
    providers = list(dict.fromkeys(providers))
    return ChatOptions(
        default_model=default_model,
        default_provider=default_provider,
        models=[ChatModelOption(name=name, provider=provider_for.get(name)) for name in model_names],
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
        # A newly-created EventSource cannot set Last-Event-ID. The explicit cursor lets the
        # frontend retain the same replay position across its extended reconnect ladder and
        # after restoring a locally cached partial response from a page reload.
        raw_last_id = request.headers.get("last-event-id") or request.query_params.get("after_seq", "0")
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

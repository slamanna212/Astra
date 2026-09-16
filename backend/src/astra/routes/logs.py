"""Logs: tail the 3 allowlisted Hermes logs, plus an SSE follow stream (BUILD-SPEC §4.5, §5.8)."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from astra import logs as logsmod
from astra.deps import Ctx
from astra.models import LogTailResponse

router = APIRouter(prefix="/api/logs", tags=["logs"])
log = logging.getLogger(__name__)

POLL_INTERVAL_S = 1.0
STREAM_TAIL_LINES = 50  # lines to backfill when the stream first opens


def _validate_file(file: str) -> str:
    if file not in logsmod.ALLOWED_LOG_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown log file {file!r}; allowed: {', '.join(logsmod.ALLOWED_LOG_FILES)}",
        )
    return file


@router.get("", response_model=LogTailResponse)
async def get_log_tail(
    ctx: Ctx,
    file: Annotated[str, Query()],
    lines: Annotated[int, Query(ge=1, le=logsmod.MAX_LINES)] = logsmod.DEFAULT_LINES,
    level: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=512)] = None,
) -> LogTailResponse:
    _validate_file(file)
    logs_dir = ctx.settings.paths.logs_dir
    try:
        tail = await anyio.to_thread.run_sync(
            lambda: logsmod.tail_log(logs_dir, file, lines=lines, level=level, search=search)
        )
    except logsmod.InvalidLogFile as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except logsmod.LogNotFound:
        return LogTailResponse(file=file, lines=[], truncated=False, total_bytes=0, mtime=0.0)
    return LogTailResponse(
        file=tail.file,
        lines=[asdict(e) for e in tail.lines],
        truncated=tail.truncated,
        total_bytes=tail.total_bytes,
        mtime=tail.mtime,
    )


@router.get("/stream")
async def stream_log(
    request: Request,
    ctx: Ctx,
    file: Annotated[str, Query()],
    level: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=512)] = None,
) -> StreamingResponse:
    """SSE: emit newly appended lines as they land. Polls file size on an interval (never a fixed
    30s poll for the *content* — this pushes appended lines as soon as the next poll tick sees
    them); handles truncation/rotation by detecting a size decrease and resetting to the new end.
    """
    _validate_file(file)
    logs_dir = ctx.settings.paths.logs_dir

    async def event_source():
        try:
            path = await anyio.to_thread.run_sync(logsmod.resolve_log_path, logs_dir, file)
        except logsmod.InvalidLogFile as exc:
            yield _sse("error", {"error": str(exc)})
            return

        # Backfill: seed with the current tail so the view isn't empty on connect.
        try:
            initial = await anyio.to_thread.run_sync(
                lambda: logsmod.tail_log(logs_dir, file, lines=STREAM_TAIL_LINES, level=level, search=search)
            )
            for entry in initial.lines:
                yield _sse("line", asdict(entry))
            position = initial.total_bytes
        except logsmod.LogNotFound:
            position = 0

        while True:
            if await request.is_disconnected():
                return
            await asyncio.sleep(POLL_INTERVAL_S)
            try:
                size = await anyio.to_thread.run_sync(lambda: path.stat().st_size)
            except FileNotFoundError:
                yield _sse("rotated", {})
                position = 0
                continue
            if size < position:
                # Truncated or rotated out from under us: reset and re-announce.
                yield _sse("rotated", {})
                position = 0
            if size > position:
                new_lines, position = await anyio.to_thread.run_sync(_read_from, path, position, size)
                for raw in new_lines:
                    entry = logsmod.parse_line(raw)
                    if level and (entry.level or "").upper() != level.upper():
                        continue
                    if search and search.lower() not in entry.raw.lower():
                        continue
                    yield _sse("line", asdict(entry))

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def _read_from(path: Path, start: int, end: int) -> tuple[list[str], int]:
    """Read newly appended, complete lines in ``[start, end)``. Never reads more than one poll's
    worth of growth; a partial trailing line (no ``\\n`` yet) is left for the next poll."""
    with path.open("rb") as fh:
        fh.seek(start)
        data = fh.read(end - start)
    if not data:
        return [], start
    last_nl = data.rfind(b"\n")
    if last_nl == -1:
        return [], start  # no complete line yet
    complete = data[:last_nl]
    consumed = start + last_nl + 1
    text = complete.decode("utf-8", errors="replace")
    lines = [ln for ln in text.split("\n") if ln != ""]
    return lines, consumed


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

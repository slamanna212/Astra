"""Scheduled tasks: read-only endpoints (BUILD-SPEC §4.5, §5.4). Writes are Phase 3.

See astra/cron_data.py + astra/hermes_bridge.py for why these never call
cron.jobs.load_jobs()/list_jobs()/get_job() or cron.executions.list_executions() directly.
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial
from pathlib import Path
from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from astra import cron_data
from astra.deps import Ctx
from astra.hermes_bridge import cron_jobs_module, cron_scheduler_module
from astra.models import (
    CronCreateRequest,
    CronJob,
    CronJobPage,
    CronOutputContent,
    CronOutputPage,
    CronOutputRun,
    CronPauseRequest,
    CronUpdateRequest,
)

router = APIRouter(prefix="/api/cron", tags=["cron"])
log = logging.getLogger(__name__)

_SCRIPT_FIELDS = ("script", "post_script", "monitor_script")


def _write_job(fn, *args, **kwargs):
    """Hermes owns jobs.json locking/normalization. Never hand-write that file here."""
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


def _merge_latest_execution(job: dict, executions_db: Path) -> dict:
    job = dict(job)
    latest = cron_data.latest_executions(executions_db, [job.get("id", "")])
    job["latest_execution"] = latest.get(job.get("id", ""))
    return job


@router.get("", response_model=CronJobPage)
async def list_cron_jobs(ctx: Ctx) -> CronJobPage:
    paths = ctx.settings.paths

    def _load() -> list[dict]:
        jobs = cron_data.list_jobs(paths.cron_jobs)
        latest = cron_data.latest_executions(paths.cron_executions_db, [j.get("id", "") for j in jobs])
        for job in jobs:
            job["latest_execution"] = latest.get(job.get("id", ""))
        return jobs

    jobs = await anyio.to_thread.run_sync(_load)
    return CronJobPage(items=[CronJob.model_validate(j) for j in jobs])


@router.post("", response_model=CronJob, status_code=201)
async def create_cron_job(body: CronCreateRequest, ctx: Ctx) -> CronJob:
    payload = body.model_dump(exclude_none=True)
    job = await anyio.to_thread.run_sync(partial(_write_job, cron_jobs_module().create_job, **payload))
    return CronJob.model_validate(_merge_latest_execution(job, ctx.settings.paths.cron_executions_db))


@router.patch("/{job_id}", response_model=CronJob)
async def update_cron_job(job_id: str, body: CronUpdateRequest, ctx: Ctx) -> CronJob:
    if not cron_data.is_safe_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    updates = body.model_dump(exclude_none=False, exclude_unset=True)
    job = await anyio.to_thread.run_sync(_write_job, cron_jobs_module().update_job, job_id, updates)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return CronJob.model_validate(_merge_latest_execution(job, ctx.settings.paths.cron_executions_db))


@router.delete("/{job_id}", status_code=204)
async def delete_cron_job(job_id: str) -> None:
    if not cron_data.is_safe_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    removed = await anyio.to_thread.run_sync(cron_jobs_module().remove_job, job_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Job not found")


@router.post("/{job_id}/pause", response_model=CronJob)
async def pause_cron_job(job_id: str, body: CronPauseRequest, ctx: Ctx) -> CronJob:
    job = await anyio.to_thread.run_sync(_write_job, cron_jobs_module().pause_job, job_id, body.reason)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return CronJob.model_validate(_merge_latest_execution(job, ctx.settings.paths.cron_executions_db))


@router.post("/{job_id}/resume", response_model=CronJob)
async def resume_cron_job(job_id: str, ctx: Ctx) -> CronJob:
    job = await anyio.to_thread.run_sync(_write_job, cron_jobs_module().resume_job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return CronJob.model_validate(_merge_latest_execution(job, ctx.settings.paths.cron_executions_db))


@router.post("/{job_id}/run", status_code=202)
async def run_cron_job(job_id: str, ctx: Ctx) -> dict[str, bool]:
    """Schedule the blocking Hermes run off the event loop; output remains in canonical cron/output."""
    if not cron_data.is_safe_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    job = await anyio.to_thread.run_sync(cron_data.get_job, ctx.settings.paths.cron_jobs, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    # The scheduler owns execution state and output persistence. It may make provider calls only
    # after an authenticated user explicitly presses Run now.
    asyncio.create_task(anyio.to_thread.run_sync(cron_scheduler_module().run_job, job))
    return {"accepted": True}


@router.get("/events")
async def cron_events(request: Request, ctx: Ctx) -> StreamingResponse:
    """SSE: emits `jobs-changed` whenever cron/jobs.json's (mtime, size) changes."""

    async def event_source():
        assert ctx.cron_events is not None
        yield ": connected\n\n"
        async with ctx.cron_events.subscribe() as queue:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield "event: jobs-changed\ndata: {}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/{job_id}", response_model=CronJob)
async def get_cron_job(job_id: str, ctx: Ctx) -> CronJob:
    paths = ctx.settings.paths
    if not cron_data.is_safe_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")

    def _load() -> dict | None:
        job = cron_data.get_job(paths.cron_jobs, job_id)
        if job is None:
            return None
        return _merge_latest_execution(job, paths.cron_executions_db)

    job = await anyio.to_thread.run_sync(_load)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return CronJob.model_validate(job)


class _ScriptNotFound(Exception):
    pass


def _load_job_script(paths, job_id: str, field: str) -> tuple[str, str]:
    job = cron_data.get_job(paths.cron_jobs, job_id)
    if job is None:
        raise _ScriptNotFound("job")
    filename = job.get(field)
    if not filename or not isinstance(filename, str):
        raise _ScriptNotFound("field")
    scripts_dir = paths.scripts_dir
    candidate = (scripts_dir / filename).resolve()
    if not candidate.is_relative_to(scripts_dir.resolve()) or candidate.is_symlink() or not candidate.is_file():
        raise _ScriptNotFound("path")
    return filename, candidate.read_text(encoding="utf-8", errors="replace")


@router.get("/{job_id}/script/{field}")
async def get_cron_job_script(job_id: str, field: str, ctx: Ctx) -> dict:
    if field not in _SCRIPT_FIELDS:
        raise HTTPException(status_code=400, detail=f"field must be one of {_SCRIPT_FIELDS}")
    paths = ctx.settings.paths
    if not cron_data.is_safe_job_id(job_id):
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        filename, content = await anyio.to_thread.run_sync(_load_job_script, paths, job_id, field)
    except _ScriptNotFound as exc:
        detail = "Job not found" if str(exc) == "job" else f"job has no readable {field}"
        raise HTTPException(status_code=404, detail=detail) from None
    return {"field": field, "filename": filename, "content": content}


def _require_known_job(paths, job_id: str) -> None:
    """Raise if job_id isn't a safe path component or isn't a real job — output/script
    endpoints must 404 on an unknown job, not silently show an empty listing."""
    if not cron_data.is_safe_job_id(job_id) or cron_data.get_job(paths.cron_jobs, job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found")


@router.get("/{job_id}/output", response_model=CronOutputPage)
async def list_cron_job_output(
    job_id: str,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
) -> CronOutputPage:
    paths = ctx.settings.paths

    def _load():
        _require_known_job(paths, job_id)
        runs, next_cursor = cron_data.list_outputs(paths.cron_output_dir, job_id, limit=limit, cursor=cursor)
        executions = cron_data.list_executions(paths.cron_executions_db, job_id, limit=limit)
        return runs, next_cursor, executions

    runs, next_cursor, executions = await anyio.to_thread.run_sync(_load)
    items = [
        CronOutputRun(
            filename=r.filename,
            timestamp=r.filename[:-3] if r.filename.endswith(".md") else None,
            size_bytes=r.size_bytes,
            mtime=r.mtime,
        )
        for r in runs
    ]
    return CronOutputPage(items=items, next_cursor=next_cursor, executions=executions)


@router.get("/{job_id}/output/{run}", response_model=CronOutputContent)
async def get_cron_job_output(job_id: str, run: str, ctx: Ctx) -> CronOutputContent:
    paths = ctx.settings.paths

    def _load() -> str:
        _require_known_job(paths, job_id)
        return cron_data.read_output(paths.cron_output_dir, job_id, run)

    try:
        content = await anyio.to_thread.run_sync(_load)
    except cron_data.InvalidOutputRun:
        raise HTTPException(status_code=404, detail="Run not found") from None
    truncated = len(content.encode("utf-8", errors="replace")) >= cron_data.MAX_OUTPUT_BYTES
    return CronOutputContent(filename=run, content=content, truncated=truncated)

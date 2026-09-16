"""Editable working-memory files; OpenViking inspection remains Phase 4."""
from __future__ import annotations

import os
import tempfile

import anyio.to_thread
import yaml
from fastapi import APIRouter, HTTPException

from astra.deps import Ctx
from astra.models import MemoryFilesResponse, MemoryWriteRequest

router = APIRouter(prefix="/api/memory", tags=["memory"])
_FILES = {"memory": ("memories", "MEMORY.md"), "user": ("memories", "USER.md"), "soul": (None, "SOUL.md")}

def _target(paths, which: str):
    if which not in _FILES: raise ValueError("unknown memory file")
    folder, name = _FILES[which]
    return (paths.home / folder / name) if folder else paths.home / name

def _config_allows(paths, which: str) -> bool:
    try: cfg = yaml.safe_load(paths.config_yaml.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError): cfg = {}
    memory = cfg.get("memory") if isinstance(cfg, dict) else {}
    return not ((which == "memory" and isinstance(memory, dict) and memory.get("memory_enabled") is False) or (which == "user" and isinstance(memory, dict) and memory.get("user_profile_enabled") is False))

def _read(paths):
    out = {}
    for which in _FILES:
        target = _target(paths, which)
        if target.is_symlink(): raise PermissionError(which)
        out[which] = target.read_text(encoding="utf-8", errors="replace") if target.is_file() else ""
    return out

def _write(paths, which: str, content: str):
    if not _config_allows(paths, which): raise PermissionError(which)
    target = _target(paths, which)
    if target.is_symlink(): raise PermissionError(which)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".astra-memory-", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, target)
    finally: os.unlink(temp) if os.path.exists(temp) else None

@router.get("/files", response_model=MemoryFilesResponse)
async def files(ctx: Ctx):
    try: return MemoryFilesResponse(files=await anyio.to_thread.run_sync(_read, ctx.settings.paths))
    except PermissionError: raise HTTPException(403, "Refusing a symlinked memory file") from None

@router.put("/files/{which}", status_code=204)
async def write(which: str, body: MemoryWriteRequest, ctx: Ctx):
    try: await anyio.to_thread.run_sync(_write, ctx.settings.paths, which, body.content)
    except ValueError: raise HTTPException(404, "Memory file not found") from None
    except PermissionError: raise HTTPException(403, "Memory file is disabled or symlinked") from None

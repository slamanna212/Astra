"""Serve raster images referenced by Hermes ``MEDIA:`` tokens."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from astra import files as filesmod
from astra.deps import Ctx
from astra.media import session_allows_media_path

router = APIRouter(prefix="/api/media", tags=["media"])

IMAGE_MIMES = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _resolve_target(raw_path: str, workspace: Path) -> tuple[Path, bool]:
    if not raw_path or "\x00" in raw_path or any(ord(char) < 0x20 for char in raw_path):
        raise HTTPException(status_code=400, detail="Invalid media path")
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = workspace / candidate
    try:
        target = candidate.resolve(strict=False)
        workspace_root = workspace.resolve(strict=False)
        in_workspace = target.is_relative_to(workspace_root)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid media path") from exc
    return target, in_workspace


def _open_image(target: Path) -> tuple[int, int]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(target, flags)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Media not found") from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Media could not be opened") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise HTTPException(status_code=400, detail="Media is not a regular file")
        return fd, info.st_size
    except Exception:
        os.close(fd)
        raise


@router.get("")
async def media_image(
    ctx: Ctx,
    path: Annotated[str, Query()],
    session_id: Annotated[str | None, Query()] = None,
) -> StreamingResponse:
    target, in_workspace = _resolve_target(path, ctx.settings.workspace_dir)
    mime = IMAGE_MIMES.get(target.suffix.lower())
    if mime is None:
        raise HTTPException(status_code=415, detail="Only raster images can be displayed inline")

    if not in_workspace:
        allowed = bool(session_id) and await ctx.db.run_with_schema(
            lambda conn, schema: session_allows_media_path(conn, schema, session_id or "", target)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Media path is not authorized")

    fd, size = await anyio.to_thread.run_sync(_open_image, target)
    return StreamingResponse(
        filesmod.iter_fd_chunks(fd),
        media_type=mime,
        headers={
            "Content-Length": str(size),
            "Content-Disposition": "inline",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )

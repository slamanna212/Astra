"""Files: browse / preview / download / upload the workspace root only (BUILD-SPEC §4.5, §5.6).

No edit / rename / delete / create-directory this phase — see ``astra/files.py`` for the full
security model (anchored, symlink-refusing, TOCTOU-safe opens; deny-wall; path validation).
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import asdict
from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from astra import files as filesmod
from astra.deps import Ctx
from astra.models import FileContent, FileListing, FileMetaModel, FileUploadResponse

router = APIRouter(prefix="/api/files", tags=["files"])
log = logging.getLogger(__name__)

_ERROR_STATUS: dict[type[Exception], int] = {
    filesmod.InvalidPath: 400,
    filesmod.DeniedPath: 400,
    filesmod.SymlinkRefused: 400,
    filesmod.NotADirectory: 400,
    filesmod.NotAFile: 400,
    filesmod.NotFound: 404,
    filesmod.AlreadyExists: 409,
    filesmod.TooLarge: 413,
}


def _raise_http(exc: Exception) -> None:
    for exc_type, status in _ERROR_STATUS.items():
        if isinstance(exc, exc_type):
            raise HTTPException(status_code=status, detail=str(exc)) from exc
    raise


@router.get("", response_model=FileListing)
async def list_files(ctx: Ctx, path: Annotated[str, Query()] = "") -> FileListing:
    root = ctx.settings.workspace_dir
    try:
        listing = await anyio.to_thread.run_sync(filesmod.list_directory, root, path)
    except filesmod.FilesError as exc:
        _raise_http(exc)
        raise  # pragma: no cover
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail="not found") from exc
    return FileListing(
        path=listing.path,
        entries=[asdict(e) for e in listing.entries],  # dataclasses -> plain dicts for pydantic
        truncated=listing.truncated,
    )


@router.get("/content", response_model=FileContent)
async def file_content(ctx: Ctx, path: Annotated[str, Query()]) -> FileContent:
    root = ctx.settings.workspace_dir
    try:
        meta = await anyio.to_thread.run_sync(filesmod.get_file_meta, root, path)
    except filesmod.FilesError as exc:
        _raise_http(exc)
        raise  # pragma: no cover
    if not filesmod.is_previewable_text(meta.name, meta.mime):
        return FileContent(
            meta=FileMetaModel(**asdict(meta)),
            content=None,
            truncated=False,
            previewable=False,
            reason=f"not previewable (mime={meta.mime or 'unknown'}, {meta.size} bytes)",
        )
    try:
        result = await anyio.to_thread.run_sync(filesmod.read_text_preview, root, path)
    except filesmod.FilesError as exc:
        _raise_http(exc)
        raise  # pragma: no cover
    return FileContent(
        meta=FileMetaModel(**asdict(result.meta)),
        content=result.content,
        truncated=result.truncated,
        previewable=True,
        reason=None,
    )


@router.get("/download")
async def download_file(ctx: Ctx, path: Annotated[str, Query()]) -> StreamingResponse:
    root = ctx.settings.workspace_dir
    try:
        fd, target = await anyio.to_thread.run_sync(filesmod.open_for_download, root, path)
    except filesmod.FilesError as exc:
        _raise_http(exc)
        raise  # pragma: no cover
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="not found") from exc

    mime = target.meta.mime or "application/octet-stream"
    headers = {
        "Content-Length": str(target.meta.size),
        "Content-Disposition": f'{target.disposition}; filename="{_escape_filename(target.meta.name)}"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    if target.csp_sandbox:
        headers["Content-Security-Policy"] = "sandbox"

    return StreamingResponse(
        filesmod.iter_fd_chunks(fd),
        media_type=mime,
        headers=headers,
    )


def _escape_filename(name: str) -> str:
    return name.replace("\\", "_").replace('"', "_")


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    ctx: Ctx,
    directory: Annotated[str, Form()] = "",
    overwrite: Annotated[bool, Form()] = False,
    file: UploadFile = File(...),
) -> FileUploadResponse:
    root = ctx.settings.workspace_dir
    max_bytes = ctx.settings.upload_max_bytes
    filename = file.filename or ""

    if file.size is not None and file.size > max_bytes:
        raise HTTPException(status_code=413, detail=f"upload exceeds the {max_bytes}-byte limit")

    def _write() -> filesmod.UploadResult:
        # Starlette has already received the multipart body into `file.file` — a SpooledTemporaryFile
        # that only buffers in memory up to its threshold, spilling to a disk-backed temp file beyond
        # that. We read it back in chunks and hand each straight to the anchored writer: at no point
        # does this process hold the whole upload as one in-memory object.
        src = file.file
        src.seek(0)

        def chunks() -> Iterator[bytes]:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

        return filesmod.save_upload_stream(
            root, directory, filename, chunks(), overwrite=overwrite, max_bytes=max_bytes
        )

    try:
        result = await anyio.to_thread.run_sync(_write)
    except filesmod.FilesError as exc:
        _raise_http(exc)
        raise  # pragma: no cover
    return FileUploadResponse(path=result.path, size=result.size)

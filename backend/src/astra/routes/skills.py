"""Skills: read-only listing + detail over $HERMES_HOME/skills (BUILD-SPEC §4.5). Writes
are Phase 3. See astra/skills_data.py for the guards reproduced from the legacy reference."""

from __future__ import annotations

from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from astra import files as filesmod
from astra import skills_data
from astra.deps import Ctx
from astra.models import (
    FileContent,
    FileMetaModel,
    SkillDetailModel,
    SkillListResponse,
    SkillSummaryModel,
    SkillToggleRequest,
    SkillWriteRequest,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _raise_file_http(exc: Exception) -> None:
    if isinstance(exc, filesmod.NotFound):
        raise HTTPException(status_code=404, detail="Supporting file not found") from exc
    if isinstance(exc, filesmod.FilesError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _supporting_file_path(category: str | None, name: str, raw_path: str) -> str:
    safe_name = skills_data.validate_segment(name)
    safe_category = skills_data.validate_segment(category) if category else None
    parts = filesmod.split_relative_path(raw_path)
    if not parts:
        raise filesmod.InvalidPath("path is required")
    if len(parts) == 1 and parts[0].casefold() == "skill.md":
        raise filesmod.InvalidPath("SKILL.md is available from the skill detail endpoint")
    return "/".join([*([safe_category] if safe_category else []), safe_name, *parts])


async def _ensure_skill(ctx: Ctx, category: str | None, name: str) -> None:
    try:
        detail = await anyio.to_thread.run_sync(
            skills_data.get_skill,
            ctx.settings.paths.skills_dir,
            ctx.settings.paths.config_yaml,
            category,
            name,
        )
    except skills_data.InvalidSkillRef:
        raise HTTPException(status_code=400, detail="Invalid skill reference") from None
    except skills_data.SymlinkedSkillFile:
        raise HTTPException(status_code=403, detail="Refusing a symlinked SKILL.md") from None
    if detail is None:
        raise HTTPException(status_code=404, detail="Skill not found")


async def _supporting_file_content(
    ctx: Ctx, category: str | None, name: str, path: str
) -> FileContent:
    await _ensure_skill(ctx, category, name)
    try:
        relative = _supporting_file_path(category, name, path)
        meta = await anyio.to_thread.run_sync(
            lambda: filesmod.get_file_meta(
                ctx.settings.paths.skills_dir, relative, enforce_deny_wall=False
            )
        )
    except (skills_data.InvalidSkillRef, filesmod.FilesError) as exc:
        if isinstance(exc, skills_data.InvalidSkillRef):
            raise HTTPException(status_code=400, detail="Invalid skill reference") from None
        _raise_file_http(exc)
        raise  # pragma: no cover

    display_meta = FileMetaModel(
        path="/".join(filesmod.split_relative_path(path)),
        name=meta.name,
        size=meta.size,
        mtime=meta.mtime,
        mime=meta.mime,
    )
    if not filesmod.is_previewable_text(meta.name, meta.mime):
        return FileContent(
            meta=display_meta,
            content=None,
            truncated=False,
            previewable=False,
            reason=f"not previewable (mime={meta.mime or 'unknown'}, {meta.size} bytes)",
        )
    try:
        result = await anyio.to_thread.run_sync(
            lambda: filesmod.read_text_preview(
                ctx.settings.paths.skills_dir, relative, enforce_deny_wall=False
            )
        )
    except filesmod.FilesError as exc:
        _raise_file_http(exc)
        raise  # pragma: no cover
    return FileContent(
        meta=display_meta,
        content=result.content,
        truncated=result.truncated,
        previewable=True,
        reason=None,
    )


async def _open_supporting_file(
    ctx: Ctx, category: str | None, name: str, path: str
) -> StreamingResponse:
    await _ensure_skill(ctx, category, name)
    try:
        relative = _supporting_file_path(category, name, path)
        fd, target = await anyio.to_thread.run_sync(
            lambda: filesmod.open_for_download(
                ctx.settings.paths.skills_dir, relative, enforce_deny_wall=False
            )
        )
    except (skills_data.InvalidSkillRef, filesmod.FilesError) as exc:
        if isinstance(exc, skills_data.InvalidSkillRef):
            raise HTTPException(status_code=400, detail="Invalid skill reference") from None
        _raise_file_http(exc)
        raise  # pragma: no cover

    filename = target.meta.name.replace("\\", "_").replace('"', "_")
    dangerous_mime = target.meta.mime in {"text/html", "application/xhtml+xml", "image/svg+xml"}
    inline_text = filesmod.is_previewable_text(target.meta.name, target.meta.mime) and not dangerous_mime
    disposition = "inline" if inline_text else target.disposition
    headers = {
        "Content-Length": str(target.meta.size),
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    if target.csp_sandbox or inline_text:
        headers["Content-Security-Policy"] = "sandbox"
    return StreamingResponse(
        filesmod.iter_fd_chunks(fd),
        media_type=target.meta.mime or "application/octet-stream",
        headers=headers,
    )


@router.get("", response_model=SkillListResponse)
async def list_skills(ctx: Ctx) -> SkillListResponse:
    paths = ctx.settings.paths
    skills = await anyio.to_thread.run_sync(skills_data.list_skills, paths.skills_dir, paths.config_yaml)
    items = [
        SkillSummaryModel(
            name=s.name,
            category=s.category,
            description=s.description,
            enabled=s.enabled,
            path=s.path,
            dir_is_symlink=s.dir_is_symlink,
            file_is_symlink=s.file_is_symlink,
        )
        for s in skills
    ]
    categories = sorted({s.category for s in skills if s.category})
    return SkillListResponse(items=items, categories=categories)


@router.get("/{category}/{name}/files/content", response_model=FileContent)
async def supporting_file_content_by_category(
    category: str, name: str, ctx: Ctx, path: Annotated[str, Query()]
) -> FileContent:
    return await _supporting_file_content(ctx, category, name, path)


@router.get("/{name}/files/content", response_model=FileContent)
async def supporting_file_content_flat(
    name: str, ctx: Ctx, path: Annotated[str, Query()]
) -> FileContent:
    return await _supporting_file_content(ctx, None, name, path)


@router.get("/{category}/{name}/files/open")
async def open_supporting_file_by_category(
    category: str, name: str, ctx: Ctx, path: Annotated[str, Query()]
) -> StreamingResponse:
    return await _open_supporting_file(ctx, category, name, path)


@router.get("/{name}/files/open")
async def open_supporting_file_flat(
    name: str, ctx: Ctx, path: Annotated[str, Query()]
) -> StreamingResponse:
    return await _open_supporting_file(ctx, None, name, path)


@router.put("/{category}/{name}", status_code=204)
async def save_skill_by_category(category: str, name: str, body: SkillWriteRequest, ctx: Ctx) -> None:
    await _save(ctx, category, name, body.content)


@router.put("/{name}", status_code=204)
async def save_skill_flat(name: str, body: SkillWriteRequest, ctx: Ctx) -> None:
    await _save(ctx, None, name, body.content)


@router.delete("/{category}/{name}", status_code=204)
async def delete_skill_by_category(category: str, name: str, ctx: Ctx) -> None:
    await _delete(ctx, category, name)


@router.delete("/{name}", status_code=204)
async def delete_skill_flat(name: str, ctx: Ctx) -> None:
    await _delete(ctx, None, name)


@router.post("/{category}/{name}/enabled", status_code=204)
async def toggle_skill_by_category(category: str, name: str, body: SkillToggleRequest, ctx: Ctx) -> None:
    await _toggle(ctx, category, name, body.enabled)


@router.post("/{name}/enabled", status_code=204)
async def toggle_skill_flat(name: str, body: SkillToggleRequest, ctx: Ctx) -> None:
    await _toggle(ctx, None, name, body.enabled)


@router.get("/{category}/{name}", response_model=SkillDetailModel)
async def get_skill_by_category(category: str, name: str, ctx: Ctx) -> SkillDetailModel:
    return await _get_skill(ctx, category, name)


@router.get("/{name}", response_model=SkillDetailModel)
async def get_skill_flat(name: str, ctx: Ctx) -> SkillDetailModel:
    return await _get_skill(ctx, None, name)


async def _get_skill(ctx: Ctx, category: str | None, name: str) -> SkillDetailModel:
    paths = ctx.settings.paths

    def _load():
        return skills_data.get_skill(paths.skills_dir, paths.config_yaml, category, name)

    try:
        detail = await anyio.to_thread.run_sync(_load)
    except skills_data.InvalidSkillRef:
        raise HTTPException(status_code=400, detail="Invalid skill reference") from None
    except skills_data.SymlinkedSkillFile:
        raise HTTPException(status_code=403, detail="Refusing a symlinked SKILL.md") from None
    if detail is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return SkillDetailModel(
        name=detail.name,
        category=detail.category,
        description=detail.description,
        enabled=detail.enabled,
        path=detail.path,
        tags=detail.tags,
        related_skills=detail.related_skills,
        frontmatter=detail.frontmatter,
        content=detail.content,
        files=detail.files,
    )


async def _save(ctx: Ctx, category: str | None, name: str, content: str) -> None:
    try:
        await anyio.to_thread.run_sync(skills_data.save_skill, ctx.settings.paths.skills_dir, category, name, content)
    except skills_data.InvalidSkillRef:
        raise HTTPException(status_code=400, detail="Invalid skill reference") from None
    except skills_data.SymlinkedSkillFile:
        raise HTTPException(status_code=403, detail="Refusing a symlinked skill") from None


async def _delete(ctx: Ctx, category: str | None, name: str) -> None:
    try:
        await anyio.to_thread.run_sync(skills_data.delete_skill, ctx.settings.paths.skills_dir, category, name)
    except skills_data.SkillNotFound:
        raise HTTPException(status_code=404, detail="Skill not found") from None
    except skills_data.InvalidSkillRef:
        raise HTTPException(status_code=400, detail="Invalid skill reference") from None
    except skills_data.SymlinkedSkillFile:
        raise HTTPException(status_code=403, detail="Refusing a symlinked skill") from None


async def _toggle(ctx: Ctx, category: str | None, name: str, enabled: bool) -> None:
    try:
        exists = await anyio.to_thread.run_sync(
            skills_data.get_skill, ctx.settings.paths.skills_dir, ctx.settings.paths.config_yaml, category, name
        )
        if exists is None:
            raise HTTPException(status_code=404, detail="Skill not found")
        await anyio.to_thread.run_sync(skills_data.set_enabled, ctx.settings.paths.config_yaml, name, enabled)
    except skills_data.InvalidSkillRef:
        raise HTTPException(status_code=400, detail="Invalid skill reference") from None
    except skills_data.SymlinkedSkillFile:
        raise HTTPException(status_code=403, detail="Refusing a symlinked skill") from None

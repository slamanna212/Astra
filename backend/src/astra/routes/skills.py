"""Skills: read-only listing + detail over $HERMES_HOME/skills (BUILD-SPEC §4.5). Writes
are Phase 3. See astra/skills_data.py for the guards reproduced from the legacy reference."""

from __future__ import annotations

import anyio.to_thread
from fastapi import APIRouter, HTTPException

from astra import skills_data
from astra.deps import Ctx
from astra.models import SkillDetailModel, SkillListResponse, SkillSummaryModel, SkillToggleRequest, SkillWriteRequest

router = APIRouter(prefix="/api/skills", tags=["skills"])


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

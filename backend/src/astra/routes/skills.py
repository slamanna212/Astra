"""Skills: read-only listing + detail over $HERMES_HOME/skills (BUILD-SPEC §4.5). Writes
are Phase 3. See astra/skills_data.py for the guards reproduced from the legacy reference."""

from __future__ import annotations

import anyio.to_thread
from fastapi import APIRouter, HTTPException

from astra import skills_data
from astra.deps import Ctx
from astra.models import SkillDetailModel, SkillListResponse, SkillSummaryModel

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

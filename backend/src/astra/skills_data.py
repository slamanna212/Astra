"""Read-only skill enumeration + detail, over ``$HERMES_HOME/skills`` only.

BUILD-SPEC §4.5 scopes the Skills API to ``$HERMES_HOME/skills`` (not project-local or
external skill directories), so unlike ``tools.skills_tool._find_all_skills`` this never scans
those extra roots — which also sidesteps that function's dependency on gateway/session context
that doesn't exist in this process.

Reuses Hermes' own frontmatter parser and directory walker (``agent.skill_utils`` — pure,
no gateway import) for exact compatibility with what the agent itself considers a skill, but
reads ``config.yaml`` directly for the disabled-set rather than
``agent.skill_utils.get_disabled_skill_names()`` — that function unconditionally imports
``gateway.session_context`` (even when an explicit ``platform`` is passed), which pulls in the
gateway subsystem. See ``astra.hermes_bridge`` for the general side-effect-avoidance rationale.

Deliberately does NOT call ``agent.skill_utils.skill_matches_environment()``: for a skill
tagged ``environments: [kanban]``, that function's kanban-active check
(``_detect_environment`` -> ``tools.kanban_tools._profile_has_kanban_toolset`` ->
``hermes_cli.config.load_config`` -> ``ensure_hermes_home()``) WRITES a default ``SOUL.md``
into ``HERMES_HOME`` if one is missing (found empirically 2026-09-16 — a read-only skills list
call created ``SOUL.md`` in a tmp HERMES_HOME with none). ``skill_matches_environment`` is an
"is this relevant to offer the agent right now" gate anyway (see its docstring: "OFFER-time
filter... intentionally NOT enforced by skill_view"), which isn't the right semantics for an
admin/management skills browser — we want every skill that exists, not just the ones relevant
to whatever transient runtime environment this process happens to look like. Only
``skill_matches_platform`` (pure ``sys.platform`` check, no I/O) is applied.
"""

from __future__ import annotations

import re
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from astra.hermes_bridge import skill_utils_module

# tools/skills_tool.py's constants (kept as plain values here rather than importing that
# module, which pulls in hermes_cli.config's heavier CLI-config stack for two integers).
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024

_PLATFORM = "webui"


class InvalidSkillRef(ValueError):
    pass


class SymlinkedSkillFile(ValueError):
    pass


class SkillNotFound(ValueError):
    pass


def normalize_segment(value: str) -> str:
    """Mirror the legacy guard: ``strip().lower().replace(' ', '-')``."""
    return value.strip().lower().replace(" ", "-")


def validate_segment(value: str) -> str:
    normalized = normalize_segment(value)
    if not normalized or "/" in normalized or ".." in normalized:
        raise InvalidSkillRef(value)
    return normalized


@dataclass(frozen=True, slots=True)
class SkillSummary:
    name: str
    category: str | None
    description: str
    enabled: bool
    path: str  # relative to skills_dir, e.g. "mlops/axolotl"
    dir_is_symlink: bool
    file_is_symlink: bool


@dataclass(frozen=True, slots=True)
class SkillDetail:
    name: str
    category: str | None
    description: str
    enabled: bool
    path: str
    tags: list[str]
    related_skills: list[str]
    frontmatter: dict
    content: str
    files: list[str] = field(default_factory=list)


def _disabled_names(config_yaml: Path, su) -> set[str]:
    """Union of ``skills.disabled`` and ``skills.platform_disabled.webui``, minus
    ``ESSENTIAL_SKILLS`` — mirrors ``agent.skill_utils.get_disabled_skill_names(platform="webui")``
    without that function's unconditional ``gateway.session_context`` import."""
    if not config_yaml.is_file():
        return set()
    try:
        cfg = yaml.safe_load(config_yaml.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return set()
    if not isinstance(cfg, dict):
        return set()
    skills_cfg = cfg.get("skills")
    if not isinstance(skills_cfg, dict):
        return set()
    global_disabled = {n.strip() for n in su.parse_config_string_list(skills_cfg.get("disabled")) if n.strip()}
    platform_disabled_cfg = skills_cfg.get("platform_disabled")
    platform_set: set[str] = set()
    if isinstance(platform_disabled_cfg, dict) and _PLATFORM in platform_disabled_cfg:
        platform_set = {
            n.strip() for n in su.parse_config_string_list(platform_disabled_cfg[_PLATFORM]) if n.strip()
        }
    return (global_disabled | platform_set) - su.ESSENTIAL_SKILLS


def _category_for(skill_md: Path, skills_dir: Path) -> str | None:
    try:
        rel = skill_md.relative_to(skills_dir)
    except ValueError:
        return None
    return rel.parts[0] if len(rel.parts) >= 3 else None


def list_skills(skills_dir: Path, config_yaml: Path) -> list[SkillSummary]:
    su = skill_utils_module()
    if not skills_dir.is_dir():
        return []
    disabled = _disabled_names(config_yaml, su)
    skills: list[SkillSummary] = []
    seen: set[str] = set()
    for skill_md in su.iter_skill_index_files(skills_dir, "SKILL.md"):
        if any(part in su.EXCLUDED_SKILL_DIRS for part in skill_md.parts):
            continue
        skill_dir = skill_md.parent
        try:
            content = skill_md.read_text(encoding="utf-8-sig", errors="replace")[:4000]
        except OSError:
            continue
        frontmatter, body = su.parse_frontmatter(content)
        if not su.skill_matches_platform(frontmatter):
            continue
        name = str(frontmatter.get("name") or skill_dir.name)[:MAX_NAME_LENGTH]
        if name in seen:
            continue
        seen.add(name)
        description = str(frontmatter.get("description") or "")
        if not description:
            for line in body.strip().split("\n"):
                line = line.strip()
                if line and not line.startswith("#"):
                    description = line
                    break
        if len(description) > MAX_DESCRIPTION_LENGTH:
            description = description[: MAX_DESCRIPTION_LENGTH - 3] + "..."
        try:
            rel_path = str(skill_md.parent.relative_to(skills_dir))
        except ValueError:
            rel_path = skill_dir.name
        skills.append(
            SkillSummary(
                name=name,
                category=_category_for(skill_md, skills_dir),
                description=description,
                enabled=name not in disabled,
                path=rel_path,
                dir_is_symlink=skill_dir.is_symlink(),
                file_is_symlink=skill_md.is_symlink(),
            )
        )
    skills.sort(key=lambda s: (s.category or "", s.name))
    return skills


_TAG_SPLIT = re.compile(r"\s*,\s*")


def _parse_tags(value: object) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(t).strip() for t in value if str(t).strip()]
    text = str(value).strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return [t.strip().strip("\"'") for t in _TAG_SPLIT.split(text) if t.strip()]


def get_skill(skills_dir: Path, config_yaml: Path, category: str | None, name: str) -> SkillDetail | None:
    """Resolve ``category/name`` (or bare ``name`` when ``category`` is None) under
    ``skills_dir``. Raises InvalidSkillRef / SymlinkedSkillFile for guard violations;
    returns None only for a genuinely missing skill."""
    su = skill_utils_module()
    safe_name = validate_segment(name)
    safe_category = validate_segment(category) if category else None

    skill_dir = skills_dir / safe_category / safe_name if safe_category else skills_dir / safe_name
    resolved_skills_dir = skills_dir.resolve()
    resolved_dir = skill_dir.resolve()
    if not resolved_dir.is_relative_to(resolved_skills_dir):
        raise InvalidSkillRef(f"{category}/{name}")

    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return None
    if skill_md.is_symlink():
        raise SymlinkedSkillFile(str(skill_md))

    content = skill_md.read_text(encoding="utf-8-sig", errors="replace")
    frontmatter, body = su.parse_frontmatter(content)
    if not su.skill_matches_platform(frontmatter):
        return None

    metadata = frontmatter.get("metadata")
    hermes_meta = metadata.get("hermes", {}) if isinstance(metadata, dict) else {}
    tags = _parse_tags(hermes_meta.get("tags") or frontmatter.get("tags"))
    related = _parse_tags(hermes_meta.get("related_skills") or frontmatter.get("related_skills"))

    description = str(frontmatter.get("description") or "")
    if not description:
        for line in body.strip().split("\n"):
            line = line.strip()
            if line and not line.startswith("#"):
                description = line
                break

    files: list[str] = []
    for entry in sorted(skill_dir.rglob("*")):
        if entry.is_file() and entry.name != "SKILL.md":
            try:
                files.append(str(entry.relative_to(skill_dir)))
            except ValueError:
                continue

    try:
        rel_path = str(skill_dir.relative_to(skills_dir))
    except ValueError:
        rel_path = safe_name

    disabled = _disabled_names(config_yaml, su)
    display_name = str(frontmatter.get("name") or skill_dir.name)[:MAX_NAME_LENGTH]

    return SkillDetail(
        name=display_name,
        category=_category_for(skill_md, skills_dir),
        description=description,
        enabled=display_name not in disabled,
        path=rel_path,
        tags=tags,
        related_skills=related,
        frontmatter=frontmatter,
        content=content,
        files=files,
    )


def _skill_path(skills_dir: Path, category: str | None, name: str) -> tuple[Path, str, str | None]:
    safe_name = validate_segment(name)
    safe_category = validate_segment(category) if category else None
    skill_dir = skills_dir / safe_category / safe_name if safe_category else skills_dir / safe_name
    if not skill_dir.resolve().is_relative_to(skills_dir.resolve()):
        raise InvalidSkillRef(f"{category}/{name}")
    return skill_dir, safe_name, safe_category


def save_skill(skills_dir: Path, category: str | None, name: str, content: str) -> None:
    skill_dir, _, _ = _skill_path(skills_dir, category, name)
    if skill_dir.exists() and skill_dir.is_symlink():
        raise SymlinkedSkillFile(str(skill_dir))
    skill_dir.mkdir(parents=True, exist_ok=True)
    target = skill_dir / "SKILL.md"
    if target.is_symlink():
        raise SymlinkedSkillFile(str(target))
    # Atomic replace prevents a partly-written instruction file on a process restart.
    fd, temp_name = tempfile.mkstemp(prefix=".astra-skill-", dir=skill_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, target)
    finally:
        Path(temp_name).unlink(missing_ok=True)


def delete_skill(skills_dir: Path, category: str | None, name: str) -> None:
    skill_dir, _, _ = _skill_path(skills_dir, category, name)
    target = skill_dir / "SKILL.md"
    if not target.is_file():
        raise SkillNotFound(name)
    if skill_dir.is_symlink() or target.is_symlink():
        raise SymlinkedSkillFile(str(target))
    # Refuse a tree containing symlinks: recursive deletion must never follow one.
    if any(path.is_symlink() for path in skill_dir.rglob("*")):
        raise SymlinkedSkillFile(str(skill_dir))
    shutil.rmtree(skill_dir)


def set_enabled(config_yaml: Path, name: str, enabled: bool) -> None:
    safe_name = validate_segment(name)
    try:
        cfg = yaml.safe_load(config_yaml.read_text(encoding="utf-8")) if config_yaml.is_file() else {}
    except (OSError, yaml.YAMLError) as exc:
        raise InvalidSkillRef("cannot read config") from exc
    if not isinstance(cfg, dict):
        cfg = {}
    skills_cfg = cfg.setdefault("skills", {})
    if not isinstance(skills_cfg, dict):
        skills_cfg = cfg["skills"] = {}
    def toggle(raw: object) -> list[str]:
        values = [str(v).strip() for v in raw] if isinstance(raw, list) else []
        return [v for v in values if v != safe_name] if enabled else list(dict.fromkeys([*values, safe_name]))
    skills_cfg["disabled"] = toggle(skills_cfg.get("disabled"))
    platform = skills_cfg.get("platform_disabled")
    if isinstance(platform, dict) and "webui" in platform:
        platform["webui"] = toggle(platform.get("webui"))
    fd, temp_name = tempfile.mkstemp(prefix=".astra-config-", dir=config_yaml.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            yaml.safe_dump(cfg, stream, allow_unicode=True, sort_keys=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, config_yaml)
    finally:
        Path(temp_name).unlink(missing_ok=True)

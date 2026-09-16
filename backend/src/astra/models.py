"""Pydantic response/request models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class AuthMe(BaseModel):
    authenticated: bool


class StateDBHealth(BaseModel):
    ok: bool


class Health(BaseModel):
    status: str
    version: str
    state_db: StateDBHealth


class Status(BaseModel):
    version: str
    hermes_home_exists: bool
    state_db_ok: bool
    session_count: int | None
    journal_mode: str | None
    hermes_src_configured: bool
    hermes_importable: bool


class SessionSummary(BaseModel):
    id: str
    title: str | None = None
    display_name: str | None = None
    source: str | None = None
    model: str | None = None
    started_at: float | None = None
    last_activity_at: float | None = None
    ended_at: float | None = None
    message_count: int = 0
    tool_call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float | None = None
    pinned: bool = False
    archived: bool = False
    hidden: bool = False
    parent_session_id: str | None = None
    last_activity_description: str | None = None


class SessionDetail(SessionSummary):
    end_reason: str | None = None
    chat_type: str | None = None
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    api_call_count: int = 0
    actual_cost_usd: float | None = None
    cost_status: str | None = None
    cost_source: str | None = None
    pricing_version: str | None = None
    billing_provider: str | None = None
    billing_mode: str | None = None
    cwd: str | None = None
    git_branch: str | None = None
    git_repo_root: str | None = None
    profile_name: str | None = None
    title_source: str | None = None
    last_read_at: float | None = None
    last_activity_provenance: str | None = None
    handoff_state: str | None = None
    handoff_platform: str | None = None
    rewind_count: int = 0


class SessionPage(BaseModel):
    items: list[SessionSummary]
    next_cursor: str | None


# -- Insights ----------------------------------------------------------------
#
# Semantics (see backend/src/astra/insights.py module docstring for the full
# evidence trail):
# * "main-loop" totals come straight from `sessions.*` — exact, no reconciliation
#   needed, matches what the session list/detail screens already show.
# * "auxiliary" spend (title generation, compression, background review, vision,
#   approval-gate calls, ...) lives only in `session_model_usage` rows with a
#   non-empty `task`, and is never folded into `sessions.*`. Reported separately
#   AND folded into `totals` (verified against Hermes' own `agent/insights.py`,
#   which does the same to avoid undercounting real spend).
# * Per-model / per-provider breakdowns are attributed from `session_model_usage`
#   rows with `task = ''` (the main agent loop), which correctly splits a
#   session that switched models mid-conversation — something `sessions.model`
#   (a single column) cannot represent.


class InsightsTotals(BaseModel):
    sessions: int
    messages: int
    api_calls: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    actual_cost_usd: float
    cache_hit_rate: float
    auxiliary_estimated_cost_usd: float
    auxiliary_input_tokens: int
    auxiliary_output_tokens: int


class InsightsDailyPoint(BaseModel):
    date: str
    sessions: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    estimated_cost_usd: float


class InsightsModelUsage(BaseModel):
    model: str
    sessions: int
    api_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    estimated_cost_usd: float
    actual_cost_usd: float


class InsightsProviderUsage(BaseModel):
    provider: str
    sessions: int
    api_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    estimated_cost_usd: float
    actual_cost_usd: float


class InsightsSourceUsage(BaseModel):
    source: str
    sessions: int
    messages: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float


class InsightsAuxiliaryTask(BaseModel):
    task: str
    sessions: int
    api_calls: int
    input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    estimated_cost_usd: float
    actual_cost_usd: float


class InsightsTopSession(BaseModel):
    id: str
    title: str | None = None
    display_name: str | None = None
    source: str | None = None
    model: str | None = None
    started_at: float | None = None
    estimated_cost_usd: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0


class InsightsResponse(BaseModel):
    days: str
    tz: str
    range_start: float | None
    range_end: float
    totals: InsightsTotals
    daily: list[InsightsDailyPoint]
    models: list[InsightsModelUsage]
    providers: list[InsightsProviderUsage]
    sources: list[InsightsSourceUsage]
    auxiliary: list[InsightsAuxiliaryTask]
    top_sessions: list[InsightsTopSession]


# -- Files ---------------------------------------------------------------
# See astra/files.py for the security model (deny-wall, anchored/symlink-refusing opens).


class FileEntryModel(BaseModel):
    name: str
    path: str
    is_dir: bool
    is_symlink: bool
    size: int
    mtime: float
    mime: str | None = None


class FileListing(BaseModel):
    path: str
    entries: list[FileEntryModel]
    truncated: bool


class FileMetaModel(BaseModel):
    path: str
    name: str
    size: int
    mtime: float
    mime: str | None = None


class FileContent(BaseModel):
    meta: FileMetaModel
    content: str | None = None
    truncated: bool = False
    previewable: bool
    reason: str | None = None


class FileUploadResponse(BaseModel):
    path: str
    size: int


# -- Logs ------------------------------------------------------------------
# See astra/logs.py: exactly 3 allowlisted files, tail-only, byte-capped.


class LogEntryModel(BaseModel):
    raw: str
    timestamp: str | None = None
    level: str | None = None
    logger: str | None = None
    session: str | None = None
    message: str | None = None


class LogTailResponse(BaseModel):
    file: str
    lines: list[LogEntryModel]
    truncated: bool
    total_bytes: int
    mtime: float


# -- Messages ----------------------------------------------------------------
# See astra/messages.py for the visibility/truncation decisions (evidence from
# hermes_state.py's own `get_messages`).


class ToolCallOut(BaseModel):
    id: str
    name: str | None = None
    arguments: Any = None
    arguments_truncated: bool = False


class Message(BaseModel):
    id: int
    role: str
    content: Any = None
    truncated: bool = False
    tool_calls: list[ToolCallOut] | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    timestamp: float
    token_count: int | None = None
    finish_reason: str | None = None
    reasoning: str | None = None
    display_kind: str | None = None
    display_metadata: dict[str, Any] | None = None
    effect_disposition: str | None = None
    active: bool = True
    compacted: bool = False


class MessagePage(BaseModel):
    items: list[Message]
    has_older: bool
    has_newer: bool
    oldest_id: int | None
    newest_id: int | None


# -- Search --------------------------------------------------------------
# See astra/search.py for FTS5 sanitization and the fts-vs-trigram decision.


class SearchHit(BaseModel):
    session_id: str
    session_title: str | None = None
    source: str | None = None
    message_id: int | None = None
    role: str
    timestamp: float | None = None
    snippet: str


class SearchPage(BaseModel):
    items: list[SearchHit]
    next_cursor: str | None


class ChildSession(BaseModel):
    id: str
    title: str | None = None
    display_name: str | None = None
    started_at: float | None = None
    source: str | None = None


class ChildSessionsResponse(BaseModel):
    items: list[ChildSession]


# -- Cron ----------------------------------------------------------------
# See astra/cron_data.py + astra/hermes_bridge.py for the side-effect-avoidance rationale.
# `extra="allow"` on CronJob: jobs.json can carry fields a Hermes upgrade adds/removes
# (BUILD-SPEC §4.3's "guard every optional kwarg" philosophy, applied to data too) — every
# field actually seen in the example fleet is still declared explicitly below so the frontend
# has a typed contract for the common case.


class CronRepeat(BaseModel):
    model_config = {"extra": "allow"}

    times: int | None = None
    completed: int | None = None


class CronOrigin(BaseModel):
    model_config = {"extra": "allow"}

    platform: str | None = None
    chat_id: str | None = None
    chat_name: str | None = None
    thread_id: str | None = None
    user_id: str | None = None


class CronJob(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    name: str
    enabled: bool = True
    state: str | None = None
    paused_at: str | None = None
    paused_reason: str | None = None

    schedule: dict[str, Any] | None = None
    schedule_display: str | None = None
    next_run_at: str | None = None
    last_run_at: str | None = None
    last_status: str | None = None
    last_error: str | None = None
    last_delivery_error: str | None = None
    failure_streak: int = 0
    repeat: CronRepeat | None = None
    created_at: str | None = None

    prompt: str | None = None
    deliver: str | None = None
    skill: str | None = None
    skills: list[str] = Field(default_factory=list)
    script: str | None = None
    post_script: str | None = None
    monitor_script: str | None = None
    monitor_url: str | None = None
    monitor_state: dict[str, Any] | None = None
    no_agent: bool = False
    context_from: list[str] | None = None
    attach_to_session: bool | None = None  # "continuity" (BUILD-SPEC §4.5)
    workdir: str | None = None

    model: str | None = None
    provider: str | None = None
    base_url: str | None = None
    model_snapshot: str | None = None
    provider_snapshot: str | None = None
    reasoning_effort: str | None = None
    enabled_toolsets: list[str] = Field(default_factory=list)

    origin: CronOrigin | None = None
    latest_execution: dict[str, Any] | None = None

    @field_validator("skills", "enabled_toolsets", mode="before")
    @classmethod
    def _none_to_list(cls, v: object) -> object:
        # Older/hand-edited jobs.json records can carry an explicit `null` for a list
        # field instead of omitting it.
        return [] if v is None else v


class CronJobPage(BaseModel):
    items: list[CronJob]


class CronOutputRun(BaseModel):
    filename: str
    timestamp: str | None = None
    size_bytes: int
    mtime: float


class CronOutputPage(BaseModel):
    items: list[CronOutputRun]
    next_cursor: str | None = None
    executions: list[dict[str, Any]] = Field(default_factory=list)


class CronOutputContent(BaseModel):
    filename: str
    content: str
    truncated: bool = False


# -- Skills ----------------------------------------------------------------
# See astra/skills_data.py. Scope is $HERMES_HOME/skills only (BUILD-SPEC §4.5).


class SkillSummaryModel(BaseModel):
    name: str
    category: str | None = None
    description: str
    enabled: bool
    path: str
    dir_is_symlink: bool
    file_is_symlink: bool


class SkillListResponse(BaseModel):
    items: list[SkillSummaryModel]
    categories: list[str]


class SkillDetailModel(BaseModel):
    name: str
    category: str | None = None
    description: str
    enabled: bool
    path: str
    tags: list[str]
    related_skills: list[str]
    frontmatter: dict[str, Any]
    content: str
    files: list[str]

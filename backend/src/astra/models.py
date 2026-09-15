"""Pydantic response/request models."""

from __future__ import annotations

from pydantic import BaseModel, Field


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

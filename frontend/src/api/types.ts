/** Wire types for the Astra backend. Timestamps are unix epoch SECONDS (float). */

export type SessionSource = 'cli' | 'cron' | 'discord' | 'subagent' | 'tui' | 'webui';

export interface SessionSummary {
  id: string;
  title: string | null;
  display_name: string | null;
  /** Usually a {@link SessionSource}, but the backend may report others. */
  source: string;
  model: string | null;
  started_at: number;
  last_activity_at: number | null;
  ended_at: number | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  pinned: boolean;
  archived: boolean;
  hidden: boolean;
  parent_session_id: string | null;
  last_activity_description: string | null;
  child_count: number;
}

/** Detail response: a SessionSummary plus backend-defined extra fields (typed loosely for now). */
export type SessionDetail = SessionSummary & Record<string, unknown>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type SessionStatus = 'active' | 'archived' | 'hidden' | 'all';

export interface SessionListFilters {
  source?: string[] | null;
  status?: SessionStatus;
}

export interface HealthResponse {
  status: string;
  version: string;
  state_db: { ok: boolean };
}

export interface MeResponse {
  authenticated: true;
}

export interface StatusResponse {
  version: string;
  hermes_home_exists: boolean;
  state_db_ok: boolean;
  session_count: number | null;
  journal_mode: string | null;
  hermes_src_configured: boolean;
  hermes_importable: boolean;
}

// -- Messages ------------------------------------------------------------
// See backend/src/astra/messages.py for the visibility/truncation decisions.

export interface ToolCall {
  id: string;
  name: string | null;
  arguments: unknown;
  arguments_truncated: boolean;
}

/** A structured multimodal part (never observed in real data; defensive). */
export type MessageContentPart = Record<string, unknown> & { type: string };

export type MessageContent = string | MessageContentPart[] | null;

export interface Message {
  id: number;
  role: string;
  content: MessageContent;
  truncated: boolean;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  timestamp: number;
  token_count: number | null;
  finish_reason: string | null;
  reasoning: string | null;
  display_kind: string | null;
  display_metadata: Record<string, unknown> | null;
  effect_disposition: string | null;
  active: boolean;
  compacted: boolean;
}

export interface MessagePage {
  items: Message[];
  has_older: boolean;
  has_newer: boolean;
  oldest_id: number | null;
  newest_id: number | null;
}

export interface ChildSession {
  id: string;
  title: string | null;
  display_name: string | null;
  started_at: number | null;
  source: string | null;
}

export interface ChildSessionsResponse {
  items: ChildSession[];
}

// -- Search ----------------------------------------------------------------
// Snippet sentinels: the backend wraps matched text in these private-use-area markers instead of
// HTML, so the frontend can highlight matches without ever using dangerouslySetInnerHTML.
export const SNIPPET_START = '';
export const SNIPPET_END = '';

export interface SearchHit {
  session_id: string;
  session_title: string | null;
  source: string | null;
  message_id: number | null;
  role: string;
  timestamp: number | null;
  snippet: string;
}

// -- Insights ----------------------------------------------------------------
//
// See backend/src/astra/insights.py for the full semantics writeup. Short version: `totals`
// combines main-loop usage (`sessions.*`) with auxiliary usage (title generation, compression,
// background review, vision, approval calls — from `session_model_usage` rows with a non-empty
// `task`) since both are real spend; `models`/`providers` cover main-loop usage only (auxiliary
// calls may use a different model/provider entirely and are broken out separately in `auxiliary`).

export type InsightsRange = '1' | '7' | '30' | '90' | '365' | 'all';

export const INSIGHTS_RANGES: InsightsRange[] = ['1', '7', '30', '90', '365', 'all'];

export interface InsightsTotals {
  sessions: number;
  messages: number;
  api_calls: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  /** Fraction in [0, 1]: cache_read_tokens / (input_tokens + cache_read_tokens). */
  cache_hit_rate: number;
  auxiliary_estimated_cost_usd: number;
  auxiliary_input_tokens: number;
  auxiliary_output_tokens: number;
}

export interface InsightsDailyPoint {
  /** Calendar date "YYYY-MM-DD" in the requested timezone. */
  date: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number;
}

export interface InsightsModelUsage {
  model: string;
  sessions: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface InsightsProviderUsage {
  provider: string;
  sessions: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface InsightsSourceUsage {
  source: string;
  sessions: number;
  messages: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface InsightsAuxiliaryTask {
  task: string;
  sessions: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface InsightsTopSession {
  id: string;
  title: string | null;
  display_name: string | null;
  source: string | null;
  model: string | null;
  started_at: number | null;
  estimated_cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
}

export interface InsightsResponse {
  days: InsightsRange;
  tz: string;
  range_start: number | null;
  range_end: number;
  totals: InsightsTotals;
  daily: InsightsDailyPoint[];
  models: InsightsModelUsage[];
  providers: InsightsProviderUsage[];
  sources: InsightsSourceUsage[];
  auxiliary: InsightsAuxiliaryTask[];
  top_sessions: InsightsTopSession[];
}

// -- Files ---------------------------------------------------------------
// Files browses ONLY the workspace root (never HERMES_HOME) — see astra/files.py for the guard
// model (deny-wall, anchored/symlink-refusing opens; ALL symlinks are refused, not just ones that
// escape the root).

export interface FileEntry {
  name: string;
  /** Workspace-relative, forward-slash separated. */
  path: string;
  is_dir: boolean;
  /** A symlink is never followed — this is reported from an lstat, and is_dir is always false for it. */
  is_symlink: boolean;
  size: number;
  mtime: number;
  mime: string | null;
}

export interface FileListing {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
}

export interface FileMeta {
  path: string;
  name: string;
  size: number;
  mtime: number;
  mime: string | null;
}

export interface FileContent {
  meta: FileMeta;
  content: string | null;
  truncated: boolean;
  previewable: boolean;
  reason: string | null;
}

export interface FileUploadResponse {
  path: string;
  size: number;
}

// -- OpenViking memory inspector ------------------------------------------
export interface OpenVikingNode { name: string; uri: string; isDir?: boolean; is_dir?: boolean; type?: string; size?: number; modTime?: string; [key: string]: unknown }
export interface OpenVikingTree { uri: string; items: OpenVikingNode[] }
export interface OpenVikingStat { count?: number; [key: string]: unknown }
export interface OpenVikingContent { uri: string; abstract: unknown; overview: unknown; content: unknown; offset: number; limit: number; hasMore?: boolean | null }
export interface OpenVikingSearchHit { uri?: string; title?: string; name?: string; content?: string; text?: string; score?: number; origin?: string; [key: string]: unknown }
export interface OpenVikingFastResult { memories: OpenVikingSearchHit[]; resources: OpenVikingSearchHit[]; skills: OpenVikingSearchHit[]; total: number }
export interface OpenVikingDeepResult { entries: OpenVikingSearchHit[]; rendered?: string; digest?: string; stats?: Record<string, unknown> }
export interface OpenVikingSearch { mode: 'fast'; result: OpenVikingFastResult }
export interface OpenVikingDeepSearch { mode: 'deep'; result: OpenVikingDeepResult }
export interface OpenVikingHealth { reachable: true; health: unknown; system: unknown }
export interface OpenVikingStatus { reachable: true; system: unknown; queue: unknown; lock: unknown; vikingdb: unknown; models: unknown; retrieval: unknown; memories: unknown; tasks: unknown }

// -- Logs ------------------------------------------------------------------
// Exactly 3 allowlisted files, tail-only — see astra/logs.py.

export const LOG_FILES = ['agent.log', 'errors.log', 'gateway.log'] as const;
export type LogFile = (typeof LOG_FILES)[number];

export interface LogEntry {
  raw: string;
  timestamp: string | null;
  level: string | null;
  logger: string | null;
  session: string | null;
  message: string | null;
}

export interface LogTailResponse {
  file: string;
  lines: LogEntry[];
  truncated: boolean;
  total_bytes: number;
  mtime: number;
}

// -- Cron / Scheduled tasks --------------------------------------------------
// Read-only in Phase 1 (writes are Phase 3) — see BUILD-SPEC §4.5, §5.4 and
// backend/src/astra/cron_data.py / hermes_bridge.py for the side-effect-avoidance rationale.
// `[key: string]: unknown` on CronJob: jobs.json can carry fields a Hermes upgrade adds — every
// field named in BUILD-SPEC §4.5 is still declared explicitly so the detail view can never
// silently drop one (see CronDetail.test.ts).

export interface CronRepeat {
  times: number | null;
  completed: number | null;
  [key: string]: unknown;
}

export interface CronOrigin {
  platform: string | null;
  chat_id: string | null;
  chat_name: string | null;
  thread_id: string | null;
  user_id: string | null;
  [key: string]: unknown;
}

export interface CronExecution {
  id: string;
  job_id: string;
  source: string;
  status: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  [key: string]: unknown;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  state: string | null;
  paused_at: string | null;
  paused_reason: string | null;

  schedule: Record<string, unknown> | null;
  schedule_display: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_delivery_error: string | null;
  failure_streak: number;
  repeat: CronRepeat | null;
  created_at: string | null;

  prompt: string | null;
  deliver: string | null;
  skill: string | null;
  skills: string[];
  script: string | null;
  post_script: string | null;
  monitor_script: string | null;
  monitor_url: string | null;
  monitor_state: Record<string, unknown> | null;
  no_agent: boolean;
  context_from: string[] | null;
  /** BUILD-SPEC §4.5 calls this "continuity" — the wire field is `attach_to_session`. */
  attach_to_session: boolean | null;
  workdir: string | null;

  model: string | null;
  provider: string | null;
  base_url: string | null;
  model_snapshot: string | null;
  provider_snapshot: string | null;
  reasoning_effort: string | null;
  enabled_toolsets: string[];

  origin: CronOrigin | null;
  latest_execution: CronExecution | null;

  [key: string]: unknown;
}

export interface CronJobPage {
  items: CronJob[];
}

export interface CronOutputRun {
  filename: string;
  timestamp: string | null;
  size_bytes: number;
  mtime: number;
}

export interface CronOutputPage {
  items: CronOutputRun[];
  next_cursor: string | null;
  executions: CronExecution[];
}

export interface CronOutputContent {
  filename: string;
  content: string;
  truncated: boolean;
}

export interface CronScriptField {
  field: string;
  filename: string;
  content: string;
}

// -- Skills -------------------------------------------------------------
// Scope is $HERMES_HOME/skills only — see backend/src/astra/skills_data.py.

export interface SkillSummary {
  name: string;
  category: string | null;
  description: string;
  enabled: boolean;
  path: string;
  dir_is_symlink: boolean;
  file_is_symlink: boolean;
}

export interface SkillListResponse {
  items: SkillSummary[];
  categories: string[];
}

export interface SkillDetail {
  name: string;
  category: string | null;
  description: string;
  enabled: boolean;
  path: string;
  tags: string[];
  related_skills: string[];
  frontmatter: Record<string, unknown>;
  content: string;
  files: string[];
}

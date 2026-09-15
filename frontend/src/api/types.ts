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
}

/** Detail response: a SessionSummary plus backend-defined extra fields (typed loosely for now). */
export type SessionDetail = SessionSummary & Record<string, unknown>;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface SessionListFilters {
  source?: string | null;
  include_archived?: boolean;
  include_hidden?: boolean;
}

export interface HealthResponse {
  status: string;
  version: string;
  state_db: { ok: boolean };
}

export interface MeResponse {
  authenticated: true;
}

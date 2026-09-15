import { apiFetch } from './client';
import type { Page, SessionDetail, SessionListFilters, SessionSummary } from './types';

export const SESSION_PAGE_SIZE = 50;

export interface ListSessionsParams extends SessionListFilters {
  limit?: number;
  cursor?: string | null;
}

export function listSessions(params: ListSessionsParams = {}, signal?: AbortSignal): Promise<Page<SessionSummary>> {
  return apiFetch<Page<SessionSummary>>('/sessions', {
    signal,
    query: {
      limit: params.limit ?? SESSION_PAGE_SIZE,
      cursor: params.cursor,
      source: params.source,
      include_archived: params.include_archived ?? false,
      include_hidden: params.include_hidden ?? false,
    },
  });
}

export function getSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, { signal });
}

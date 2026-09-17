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
      source: params.source ?? undefined,
      status: params.status ?? 'active',
    },
  });
}

export function countArchivedSessions(source: string[] | null, signal?: AbortSignal): Promise<number> {
  return apiFetch<{ count: number }>('/sessions/count', {
    signal,
    query: { status: 'archived', source: source ?? undefined },
  }).then((r) => r.count);
}

export function getSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, { signal });
}

export function createSession(body: { title?: string; model?: string }): Promise<SessionDetail> {
  return apiFetch<SessionDetail>('/sessions', { method: 'POST', body });
}

export function forkSession(id: string, messageId: number): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/sessions/${encodeURIComponent(id)}/fork`, {
    method: 'POST',
    body: { message_id: messageId },
  });
}

export function updateSession(
  id: string,
  body: { title?: string | null; pinned?: boolean; archived?: boolean; hidden?: boolean },
): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export function deleteSession(id: string): Promise<void> {
  return apiFetch<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

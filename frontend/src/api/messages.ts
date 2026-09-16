import { apiFetch } from './client';
import type { ChildSessionsResponse, Message, MessagePage } from './types';

export const MESSAGE_PAGE_SIZE = 200;

export interface MessageWindowParams {
  limit?: number;
  before_id?: number;
  after_id?: number;
  around_id?: number;
  include_inactive?: boolean;
}

export function listMessages(
  sessionId: string,
  params: MessageWindowParams = {},
  signal?: AbortSignal,
): Promise<MessagePage> {
  return apiFetch<MessagePage>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    signal,
    query: {
      limit: params.limit ?? MESSAGE_PAGE_SIZE,
      before_id: params.before_id,
      after_id: params.after_id,
      around_id: params.around_id,
      include_inactive: params.include_inactive ?? false,
    },
  });
}

export function getMessage(sessionId: string, messageId: number, signal?: AbortSignal): Promise<Message> {
  return apiFetch<Message>(`/sessions/${encodeURIComponent(sessionId)}/messages/${messageId}`, { signal });
}

export function getChildSessions(sessionId: string, signal?: AbortSignal): Promise<ChildSessionsResponse> {
  return apiFetch<ChildSessionsResponse>(`/sessions/${encodeURIComponent(sessionId)}/children`, { signal });
}

import { apiFetch } from './client';
import type { ChildSessionsResponse, Message, MessagePage } from './types';

export const MESSAGE_PAGE_SIZE = 200;
export const MESSAGE_EXPORT_PAGE_SIZE = 500;

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

/** Load the complete visible transcript in chronological order for conversation exports. */
export async function listAllMessages(sessionId: string, signal?: AbortSignal): Promise<Message[]> {
  const messages: Message[] = [];
  let afterId = 0;

  while (true) {
    const page = await listMessages(
      sessionId,
      { limit: MESSAGE_EXPORT_PAGE_SIZE, after_id: afterId },
      signal,
    );
    messages.push(...page.items);
    if (!page.has_newer || page.newest_id === null) break;
    // Guard against a malformed/non-advancing page causing an infinite export loop.
    if (page.newest_id <= afterId) throw new Error('Message export pagination did not advance');
    afterId = page.newest_id;
  }

  // Window responses cap very large message bodies. Export their full detail instead.
  return Promise.all(messages.map((message) => (
    message.truncated ? getMessage(sessionId, message.id, signal) : message
  )));
}

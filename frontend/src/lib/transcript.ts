import type { Message } from '../api/types';

/** Index `tool` role messages by the `tool_call_id` they answer, for pairing with the assistant
 * message that issued the call. Later results win if a `tool_call_id` repeats (e.g. a retried
 * call recorded twice) so a pairing always reflects the most recent row in insertion order. */
export function buildToolResultIndex(messages: Message[]): Map<string, Message> {
  const index = new Map<string, Message>();
  for (const message of messages) {
    if (message.role === 'tool' && message.tool_call_id) {
      index.set(message.tool_call_id, message);
    }
  }
  return index;
}

/** Best-effort: which child (subagent) sessions a `delegate_task` tool call spawned. Hermes does
 * not record an explicit call->session id link, so this matches by proximity — a child session
 * whose `started_at` is shortly after the tool call's timestamp (see astra/messages.py's
 * `list_child_sessions` for the evidence: one delegate_task call spawned 3 children within
 * ~70ms of each other, ~1.2s after the call). */
const DELEGATION_WINDOW_SECONDS = 120;

export function findDelegatedChildren<T extends { started_at: number | null }>(
  children: T[],
  callTimestamp: number,
): T[] {
  return children.filter((c) => {
    if (c.started_at === null) return false;
    const delta = c.started_at - callTimestamp;
    return delta >= 0 && delta <= DELEGATION_WINDOW_SECONDS;
  });
}

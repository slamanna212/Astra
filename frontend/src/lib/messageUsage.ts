import type { Message } from '../api/types';

export interface MessageUsage {
  tokens: number;
  estimatedTokens: boolean;
  estimatedCostUsd: number | null;
}

function serializedLength(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/** Use Hermes' count when present; old transcripts get the same conservative 4 chars/token
 * fallback as the context meter. Cost is apportioned using the session's effective average
 * token price because Hermes does not persist a price on individual message rows. */
export function messageUsage(
  message: Message,
  sessionTokens: number,
  sessionCostUsd: number | null,
): MessageUsage {
  const stored = message.token_count !== null && message.token_count >= 0;
  const characters = serializedLength(message.content)
    + serializedLength(message.reasoning)
    + serializedLength(message.tool_calls);
  const tokens = stored ? (message.token_count ?? 0) : Math.ceil(characters / 4);
  const estimatedCostUsd = sessionCostUsd !== null && sessionTokens > 0
    ? (tokens / sessionTokens) * sessionCostUsd
    : null;
  return { tokens, estimatedTokens: !stored, estimatedCostUsd };
}

export function formatMessageCost(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `~$${value.toFixed(4)}`;
  return `~$${value.toFixed(2)}`;
}

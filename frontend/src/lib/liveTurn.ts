import type { LiveActivityEvent } from './liveActivity';
import type { Message } from '../api/types';

/** Client-side placeholder for the turn currently streaming into the transcript. It exists so the
 * reader sees their own message and the forming answer in the chronological position those rows
 * will occupy once canonical history catches up. */
export interface LiveTurn {
  userText: string | null;
  answer: string;
  reasoning: string;
  events: LiveActivityEvent[];
  state: 'sending' | 'running' | 'reconnecting' | 'finishing' | 'failed';
}

const ACTIVITY_KINDS = new Set(['tool', 'subagent', 'status']);

/** One coarse, screen-reader-stable label per turn phase — never one announcement per token. */
export function deriveLivePhase(turn: LiveTurn): string {
  if (turn.state === 'sending') return 'Sending';
  if (turn.state === 'reconnecting') return 'Reconnecting';
  if (turn.state === 'failed') return 'Error';
  if (turn.state === 'finishing') return 'Finishing';
  if (turn.answer) return 'Writing';
  if (turn.events.some((event) => ACTIVITY_KINDS.has(event.kind))) return 'Working';
  if (turn.reasoning) return 'Thinking';
  return 'Working';
}

/** The live row is a placeholder for an answer that is not durable yet. Once the canonical window
 * already carries that answer text, rendering both would duplicate it. */
export function isLiveAnswerCanonical(messages: Message[], liveTurn: LiveTurn | null): boolean {
  if (!liveTurn?.answer) return false;
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || typeof last.content !== 'string') return false;
  const canonical = last.content.trim();
  return canonical.length > 0 && liveTurn.answer.startsWith(canonical);
}

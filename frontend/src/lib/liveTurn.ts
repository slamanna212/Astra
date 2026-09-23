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
  /**
   * `unreconciled` is distinct from `finishing`: the turn is over but the canonical reload failed,
   * so the text on screen is real but unconfirmed against saved history.
   */
  state: 'sending' | 'running' | 'reconnecting' | 'finishing' | 'unreconciled' | 'failed';
}

const ACTIVITY_KINDS = new Set(['tool', 'subagent', 'status']);

/** Activity kinds rendered as inline tool/subagent cards. Reasoning and answer text render separately. */
export function isWorkspaceActivity(event: LiveActivityEvent): boolean {
  return ACTIVITY_KINDS.has(event.kind);
}

/** One coarse, screen-reader-stable label per turn phase — never one announcement per token. */
export function deriveLivePhase(turn: LiveTurn): string {
  if (turn.state === 'sending') return 'Sending';
  if (turn.state === 'reconnecting') return 'Reconnecting';
  if (turn.state === 'failed') return 'Error';
  if (turn.state === 'unreconciled') return 'Refresh failed';
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

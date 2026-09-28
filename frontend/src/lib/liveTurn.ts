import type { LiveActivityEvent } from './liveActivity';
import type { Message } from '../api/types';
import { toolTitle } from './toolDisplay';
import type { TurnBlock } from './turnBlocks';

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
  /** When this browser first saw the turn start (ms since epoch), for the elapsed timer. */
  startedAt?: number;
}

export interface LiveStatus {
  label: string;
  tone: 'active' | 'error';
}

function lastRunningTool(blocks: TurnBlock[]): string | null | undefined {
  for (let b = blocks.length - 1; b >= 0; b -= 1) {
    const block = blocks[b]!;
    if (block.kind !== 'activity') continue;
    for (let i = block.items.length - 1; i >= 0; i -= 1) {
      const item = block.items[i]!;
      if (item.kind === 'tool' && item.status === 'running') return item.name;
    }
  }
  return undefined;
}

/**
 * One coarse, screen-reader-stable label for what the turn is doing right now — never one
 * announcement per token. Built from the most recent event, so it reflects the actual step
 * (waiting on the model, running a command, writing) rather than just "waiting".
 */
export function deriveLiveStatus(turn: LiveTurn, blocks: TurnBlock[]): LiveStatus {
  if (turn.state === 'sending') return { label: 'Sending', tone: 'active' };
  if (turn.state === 'reconnecting') return { label: 'Reconnecting', tone: 'active' };
  if (turn.state === 'failed') return { label: 'Stopped with an error', tone: 'error' };
  if (turn.state === 'unreconciled') return { label: 'Could not refresh saved history', tone: 'error' };
  if (turn.state === 'finishing') return { label: 'Finishing', tone: 'active' };

  const running = lastRunningTool(blocks);
  if (running !== undefined) return { label: toolTitle(running, true), tone: 'active' };
  for (let i = turn.events.length - 1; i >= 0; i -= 1) {
    const event = turn.events[i]!;
    if (event.kind === 'phase') {
      const phase = event.data?.phase;
      // The model call returned and Hermes is acting on it (running tools, saving).
      if (phase === 'model_done') return { label: 'Working', tone: 'active' };
      if (phase === 'model') return { label: 'Waiting for the model', tone: 'active' };
      const label = typeof event.data?.label === 'string' && event.data.label ? event.data.label : 'Working';
      return { label, tone: 'active' };
    }
    if (event.kind === 'reasoning') return { label: 'Thinking', tone: 'active' };
    if (event.kind === 'assistant') return { label: 'Writing', tone: 'active' };
    if (event.kind === 'subagent') return { label: 'Subagents working', tone: 'active' };
    return { label: 'Working', tone: 'active' };
  }
  return { label: 'Starting', tone: 'active' };
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

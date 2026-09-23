export type LiveActivityKind = 'reasoning' | 'assistant' | 'tool' | 'subagent' | 'status';

export interface LiveActivityEvent {
  kind: LiveActivityKind;
  text?: string;
  data?: Record<string, unknown>;
}

export const MAX_LIVE_ACTIVITY_EVENTS = 200;

/**
 * Preserve event order while coalescing adjacent token/reasoning deltas. Tool and subagent
 * events remain individual, inspectable entries. The cap bounds opportunistic browser recovery.
 */
export function appendLiveActivity(
  current: LiveActivityEvent[],
  additions: LiveActivityEvent[],
): LiveActivityEvent[] {
  if (additions.length === 0) return current;
  const next = current.slice();
  for (const addition of additions) {
    const previous = next.at(-1);
    if (
      previous &&
      (addition.kind === 'reasoning' || addition.kind === 'assistant') &&
      previous.kind === addition.kind
    ) {
      next[next.length - 1] = { ...previous, text: `${previous.text ?? ''}${addition.text ?? ''}` };
    } else {
      next.push({ ...addition });
    }
  }
  return next.slice(-MAX_LIVE_ACTIVITY_EVENTS);
}

export function isLiveActivityEvent(value: unknown): value is LiveActivityEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<LiveActivityEvent>;
  return (
    event.kind === 'reasoning' ||
    event.kind === 'assistant' ||
    event.kind === 'tool' ||
    event.kind === 'subagent' ||
    event.kind === 'status'
  );
}

export function parseLiveActivityData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { value: raw };
  }
}

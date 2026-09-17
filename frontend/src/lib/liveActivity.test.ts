import { describe, expect, it } from 'vitest';
import { appendLiveActivity, MAX_LIVE_ACTIVITY_EVENTS, parseLiveActivityData } from './liveActivity';

describe('live activity timeline', () => {
  it('coalesces only adjacent text of the same kind and preserves execution order', () => {
    const events = appendLiveActivity([], [
      { kind: 'reasoning', text: 'inspect ' },
      { kind: 'reasoning', text: 'files' },
      { kind: 'tool', data: { name: 'search_files' } },
      { kind: 'reasoning', text: 'edit next' },
      { kind: 'assistant', text: 'Done' },
    ]);

    expect(events).toEqual([
      { kind: 'reasoning', text: 'inspect files' },
      { kind: 'tool', data: { name: 'search_files' } },
      { kind: 'reasoning', text: 'edit next' },
      { kind: 'assistant', text: 'Done' },
    ]);
  });

  it('keeps every tool event individual and bounds browser recovery', () => {
    const additions = Array.from({ length: MAX_LIVE_ACTIVITY_EVENTS + 10 }, (_, index) => ({
      kind: 'tool' as const,
      data: { index },
    }));
    const events = appendLiveActivity([], additions);
    expect(events).toHaveLength(MAX_LIVE_ACTIVITY_EVENTS);
    expect(events[0]?.data).toEqual({ index: 10 });
  });

  it('parses structured SSE payloads and safely wraps plain text', () => {
    expect(parseLiveActivityData('{"name":"terminal"}')).toEqual({ name: 'terminal' });
    expect(parseLiveActivityData('not-json')).toEqual({ value: 'not-json' });
  });
});

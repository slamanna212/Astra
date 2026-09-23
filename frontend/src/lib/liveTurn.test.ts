import { describe, expect, it } from 'vitest';
import { groupLiveActivity, type LiveToolItem } from './liveTurn';

const started = (name: string, preview = '') => ({ kind: 'tool' as const, data: { event: 'tool.started', name, preview } });
const completed = (name: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'tool' as const, data: { event: 'tool.completed', name, ...extra } });

describe('groupLiveActivity', () => {
  it('merges start and completion into one card per call, FIFO per tool name', () => {
    const items = groupLiveActivity([
      started('terminal', 'ls'),
      started('terminal', 'pwd'),
      started('web_extract'),
      completed('terminal', { duration: 0.5, result: 'files' }),
      completed('web_extract', { is_error: true }),
    ]) as LiveToolItem[];
    expect(items.map((item) => [item.name, item.preview, item.status])).toEqual([
      ['terminal', 'ls', 'done'],
      ['terminal', 'pwd', 'running'],
      ['web_extract', '', 'error'],
    ]);
    expect(items[0]!.duration).toBe(0.5);
    expect(items[0]!.result).toBe('files');
  });

  it('drops completions whose start was already handed over to saved history', () => {
    expect(groupLiveActivity([completed('terminal')])).toEqual([]);
  });

  it('passes through non-lifecycle events untouched', () => {
    const event = { kind: 'subagent' as const, data: { message: 'spawned' } };
    expect(groupLiveActivity([event])).toEqual([{ type: 'event', event }]);
  });
});

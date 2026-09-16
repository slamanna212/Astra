import { describe, expect, it } from 'vitest';
import type { Message } from '../api/types';
import { buildToolResultIndex, findDelegatedChildren } from './transcript';

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 1,
    role: 'user',
    content: null,
    truncated: false,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    timestamp: 0,
    token_count: null,
    finish_reason: null,
    reasoning: null,
    display_kind: null,
    display_metadata: null,
    effect_disposition: null,
    active: true,
    compacted: false,
    ...overrides,
  };
}

describe('buildToolResultIndex', () => {
  it('indexes tool-role messages by tool_call_id', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', tool_calls: [{ id: 'call_1', name: 'x', arguments: {}, arguments_truncated: false }] }),
      makeMessage({ id: 2, role: 'tool', tool_call_id: 'call_1', content: 'result-1' }),
      makeMessage({ id: 3, role: 'tool', tool_call_id: 'call_2', content: 'result-2' }),
    ];
    const index = buildToolResultIndex(messages);
    expect(index.get('call_1')?.content).toBe('result-1');
    expect(index.get('call_2')?.content).toBe('result-2');
    expect(index.has('call_3')).toBe(false);
  });

  it('ignores tool messages without a tool_call_id', () => {
    const messages = [makeMessage({ id: 1, role: 'tool', tool_call_id: null, content: 'orphan' })];
    expect(buildToolResultIndex(messages).size).toBe(0);
  });

  it('later duplicate tool_call_id rows win', () => {
    const messages = [
      makeMessage({ id: 1, role: 'tool', tool_call_id: 'call_1', content: 'first' }),
      makeMessage({ id: 2, role: 'tool', tool_call_id: 'call_1', content: 'second' }),
    ];
    expect(buildToolResultIndex(messages).get('call_1')?.content).toBe('second');
  });
});

describe('findDelegatedChildren', () => {
  const children = [
    { id: 'a', started_at: 100 },
    { id: 'b', started_at: 101.2 },
    { id: 'c', started_at: 400 },
    { id: 'd', started_at: 50 },
    { id: 'e', started_at: null },
  ];

  it('matches children started shortly after the call, within the delegation window', () => {
    const matched = findDelegatedChildren(children, 100).map((c) => c.id);
    expect(matched).toEqual(['a', 'b']);
  });

  it('excludes children started before the call', () => {
    expect(findDelegatedChildren(children, 100).some((c) => c.id === 'd')).toBe(false);
  });

  it('excludes children with no started_at', () => {
    expect(findDelegatedChildren(children, 100).some((c) => c.id === 'e')).toBe(false);
  });

  it('excludes children far outside the delegation window', () => {
    expect(findDelegatedChildren(children, 100).some((c) => c.id === 'c')).toBe(false);
  });
});

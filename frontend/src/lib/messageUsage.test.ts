import { describe, expect, it } from 'vitest';
import type { Message } from '../api/types';
import { formatMessageCost, messageUsage } from './messageUsage';

const base: Message = {
  id: 1,
  role: 'assistant',
  content: '12345678',
  truncated: false,
  tool_calls: null,
  tool_call_id: null,
  tool_name: null,
  timestamp: 1,
  token_count: null,
  finish_reason: null,
  reasoning: null,
  display_kind: null,
  display_metadata: null,
  effect_disposition: null,
  active: true,
  compacted: false,
};

describe('messageUsage', () => {
  it('prefers a persisted token count and apportions session cost', () => {
    expect(messageUsage({ ...base, token_count: 25 }, 100, 1)).toEqual({
      tokens: 25,
      estimatedTokens: false,
      estimatedCostUsd: 0.25,
    });
  });

  it('estimates legacy rows from serialized content', () => {
    expect(messageUsage(base, 0, null)).toEqual({
      tokens: 2,
      estimatedTokens: true,
      estimatedCostUsd: null,
    });
  });

  it('keeps sub-cent message costs visible', () => {
    expect(formatMessageCost(0.0012)).toBe('~$0.0012');
  });
});

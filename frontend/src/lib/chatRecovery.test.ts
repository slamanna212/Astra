import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_RECOVERY_MAX_AGE_MS,
  CHAT_RECONNECT_DELAYS_MS,
  clearChatRecovery,
  loadChatRecovery,
  saveChatRecovery,
} from './chatRecovery';

describe('chat recovery', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a partial response and its replay cursor', () => {
    saveChatRecovery('session-1', {
      lastEventId: 17,
      streaming: 'partial answer',
      reasoning: 'working',
      activity: ['Tool: search'],
    }, 1_000);

    expect(loadChatRecovery('session-1', 1_001)).toEqual({
      updatedAt: 1_000,
      lastEventId: 17,
      streaming: 'partial answer',
      reasoning: 'working',
      activity: ['Tool: search'],
    });
  });

  it('expires abandoned partial responses', () => {
    saveChatRecovery('session-1', {
      lastEventId: 1,
      streaming: 'old',
      reasoning: '',
      activity: [],
    }, 1_000);

    expect(loadChatRecovery('session-1', 1_000 + CHAT_RECOVERY_MAX_AGE_MS + 1)).toBeNull();
  });

  it('clears only the selected session', () => {
    const partial = { lastEventId: 1, streaming: 'x', reasoning: '', activity: [] };
    saveChatRecovery('one', partial, 1_000);
    saveChatRecovery('two', partial, 1_000);
    clearChatRecovery('one');
    expect(loadChatRecovery('one', 1_001)).toBeNull();
    expect(loadChatRecovery('two', 1_001)).not.toBeNull();
  });

  it('bounds recovery storage to the eight most recent sessions', () => {
    for (let index = 0; index < 9; index += 1) {
      saveChatRecovery(`session-${index}`, {
        lastEventId: index,
        streaming: String(index),
        reasoning: '',
        activity: [],
      }, 1_000 + index);
    }

    expect(loadChatRecovery('session-0', 1_010)).toBeNull();
    expect(loadChatRecovery('session-8', 1_010)?.streaming).toBe('8');
  });

  it('uses the extended reconnect ladder', () => {
    expect(CHAT_RECONNECT_DELAYS_MS).toEqual([1_500, 3_000, 5_000, 8_000, 12_000, 20_000]);
  });
});

import { describe, expect, it } from 'vitest';
import { chatStreamUrl } from './chat';

describe('chatStreamUrl', () => {
  it('adds a replay cursor only when one has been observed', () => {
    expect(chatStreamUrl('session/one')).toBe('/api/chat/session%2Fone/stream');
    expect(chatStreamUrl('session/one', 42)).toBe('/api/chat/session%2Fone/stream?after_seq=42');
  });
});

import { describe, expect, it } from 'vitest';
import { parentVikingUri } from './memoryUri';

describe('parentVikingUri', () => {
  it.each([
    ['viking://user/default/memories', 'viking://user/default'],
    ['viking://user/default', 'viking://user'],
    ['viking://user', 'viking://'],
    ['viking://', 'viking://'],
  ])('maps %s to %s', (uri, expected) => {
    expect(parentVikingUri(uri)).toBe(expected);
  });

  it('falls back to the valid root for malformed input', () => {
    expect(parentVikingUri('/user/default')).toBe('viking://');
  });
});

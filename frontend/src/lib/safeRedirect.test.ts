import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safeRedirect';

describe('safeRedirectPath', () => {
  it('allows in-app paths', () => {
    expect(safeRedirectPath('/chats/abc?x=1')).toBe('/chats/abc?x=1');
  });
  it('rejects external and login targets', () => {
    expect(safeRedirectPath('//evil.example')).toBe('/chats');
    expect(safeRedirectPath('https://evil.example')).toBe('/chats');
    expect(safeRedirectPath('/\\evil.example')).toBe('/chats');
    expect(safeRedirectPath('/login?next=/x')).toBe('/chats');
    expect(safeRedirectPath(null)).toBe('/chats');
  });
});

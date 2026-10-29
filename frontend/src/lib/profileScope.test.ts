import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.resetModules();
});

async function scopeAt(path: string) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  return import('./profileScope');
}

describe('profileFromPath', () => {
  it('reads the profile out of a /p/<name> path', async () => {
    const { profileFromPath } = await scopeAt('/');
    expect(profileFromPath('/p/writer/chats')).toBe('writer');
    expect(profileFromPath('/p/writer')).toBe('writer');
    expect(profileFromPath('/p/researcher%2Fsub/chats')).toBe('researcher/sub');
  });

  it('treats anything else as the default profile', async () => {
    const { profileFromPath } = await scopeAt('/');
    expect(profileFromPath('/chats')).toBe('default');
    expect(profileFromPath('/')).toBe('default');
    // Not a profile segment: a page that merely starts with "p".
    expect(profileFromPath('/profiles')).toBe('default');
    expect(profileFromPath('/p/')).toBe('default');
  });
});

describe('profile paths', () => {
  it('keeps the default profile on the original, un-prefixed URLs', async () => {
    const scope = await scopeAt('/chats');
    expect(scope.currentProfile).toBe('default');
    expect(scope.appBase).toBe('');
    expect(scope.pathForProfile('default', '/chats')).toBe('/chats');
    expect(scope.currentInProfilePath('/chats/s1')).toBe('/chats/s1');
  });

  it('prefixes a named profile and strips the prefix back off', async () => {
    const scope = await scopeAt('/p/writer/chats/s1');
    expect(scope.currentProfile).toBe('writer');
    expect(scope.appBase).toBe('/p/writer');
    expect(scope.pathForProfile('writer', '/chats')).toBe('/p/writer/chats');
    expect(scope.currentInProfilePath('/p/writer/chats/s1')).toBe('/chats/s1');
    // A path from another document must not be trimmed with this document's prefix.
    expect(scope.currentInProfilePath('/p/other/chats')).toBe('/p/other/chats');
  });

  it('builds a Bot Chat URL per profile', async () => {
    const scope = await scopeAt('/p/writer/bots');
    expect(scope.botChatPath()).toBe('/p/writer/bots/chat');
    expect(scope.botChatPath('default')).toBe('/bots/chat');
  });
});

describe('switchProfile', () => {
  it('loads the other profile as a new document, keeping the section', async () => {
    const scope = await scopeAt('/p/writer/chats/s1');
    const assign = vi.fn();
    expect(scope.switchProfile('researcher', '/chats/s1', '?x=1', assign)).toBe(
      '/p/researcher/chats/s1?x=1',
    );
    expect(assign).toHaveBeenCalledWith('/p/researcher/chats/s1?x=1');
  });

  it('sends the default profile back to un-prefixed URLs', async () => {
    const scope = await scopeAt('/p/writer/chats');
    const assign = vi.fn();
    expect(scope.switchProfile('default', '/chats', '', assign)).toBe('/chats');
  });
});

describe('keys', () => {
  it('namespaces storage and query keys by profile', async () => {
    const scope = await scopeAt('/p/writer/chats');
    expect(scope.profileStorageKey('draft:s1')).toBe('astra.profile.writer:draft:s1');
    expect(scope.profileQueryKey(['sessions', 'list'])).toEqual(['profile', 'writer', 'sessions', 'list']);
  });
});

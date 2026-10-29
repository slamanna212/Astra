import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/render';

const roster = {
  profiles: [
    {
      name: 'default',
      title: 'Home',
      description: '',
      role: null,
      avatar_url: null,
      has_avatar: false,
      model: 'deepseek-flash',
      provider: 'deepseek',
      is_default: true,
      hidden: false,
      section: null,
      bot_session_id: 's1',
      running: false,
      updated_at: 10,
      preview: null,
      message_count: 3,
      unread: false,
    },
  ],
};

describe('profiles api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lists profiles as a page and unwraps the roster', async () => {
    fetchMock.mockResolvedValue(jsonResponse(roster));
    const { listProfiles } = await import('./profiles');
    const page = await listProfiles();
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/bots');
  });

  it('creates, updates, duplicates and deletes through the registry', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ...roster.profiles[0], name: 'writer' }, 201));
    const api = await import('./profiles');

    await api.createProfile({ name: 'writer', title: 'Writer' });
    await api.updateProfile('writer', { soul: 'be terse', hidden: true });
    await api.duplicateProfile('writer', { name: 'writer-copy' });
    await api.deleteProfile('writer-copy');

    const calls = fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method]);
    expect(calls).toEqual([
      ['/api/bots', 'POST'],
      ['/api/bots/writer', 'PATCH'],
      ['/api/bots/writer/duplicate', 'POST'],
      ['/api/bots/writer-copy', 'DELETE'],
    ]);
    const patchBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(patchBody).toEqual({ soul: 'be terse', hidden: true });
  });

  it('resolves the canonical bot chat without sending a session id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ session_id: 'abc', created: true }));
    const { ensureBotChat } = await import('./profiles');
    expect(await ensureBotChat('writer')).toEqual({ session_id: 'abc', created: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/bots/writer/bot-chat');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('posts avatars as multipart with the CSRF header and surfaces the server detail', async () => {
    const { uploadAvatar } = await import('./profiles');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...roster.profiles[0], has_avatar: true }));
    const file = new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' });
    await uploadAvatar('writer', file);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bots/writer/avatar');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect((init as RequestInit).headers).toMatchObject({ 'X-Requested-With': 'astra' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Avatar must be 2 MB or smaller' }, 413));
    await expect(uploadAvatar('writer', file)).rejects.toThrow('Avatar must be 2 MB or smaller');
  });

  it('falls back to initials and versioned avatar URLs', async () => {
    const { initialsOf, avatarSrc } = await import('./profiles');
    expect(initialsOf({ name: 'writer', title: 'Copy Editor' })).toBe('CE');
    expect(initialsOf({ name: 'writer', title: 'Researcher' })).toBe('RE');
    expect(initialsOf({ name: 'wm', title: '' })).toBe('WM');
    expect(avatarSrc({ name: 'writer', avatar_url: null })).toBeNull();
    expect(avatarSrc({ name: 'writer', avatar_url: '/api/bots/writer/avatar', updated_at: 5 })).toBe(
      '/api/bots/writer/avatar?v=5',
    );
  });
});

import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { window.history.replaceState(null, '', '/'); vi.resetModules(); });

it('binds every transport to the URL profile for the document lifetime, never a shared cookie', async () => {
  window.history.replaceState(null, '', '/p/research/chats/same');
  vi.resetModules();
  const { buildUrl } = await import('./client');
  const { chatStreamUrl } = await import('./chat');
  const { fileDownloadUrl } = await import('./files');
  expect(buildUrl('/sessions')).toBe('/api/profiles/research/sessions');
  expect(chatStreamUrl('same', 9)).toBe('/api/profiles/research/chat/same/stream?after_seq=9');
  expect(fileDownloadUrl('a b')).toBe('/api/profiles/research/files/download?path=a+b');
  expect(buildUrl('/auth/me')).toBe('/api/auth/me');
  expect(buildUrl('/health')).toBe('/api/health');
  expect(buildUrl('/profiles')).toBe('/api/profiles');
  window.history.replaceState(null, '', '/p/writer/chats/same');
  expect(buildUrl('/chat/same/stop')).toBe('/api/profiles/research/chat/same/stop');
});

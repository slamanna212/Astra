import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { history.replaceState(null, '', '/'); localStorage.clear(); vi.resetModules(); });

it('isolates identical session IDs, preferences, recovery and pending queues between two profile documents', async () => {
  history.replaceState(null, '', '/p/research/chats/same'); vi.resetModules();
  const a = await import('./composerDrafts');
  const qa = await import('../api/queryKeys');
  const ra = await import('./chatRecovery');
  const ba = await import('./busyTurnQueue');
  const pa = await import('./uiPreferences');
  a.saveComposerDraft('same', 'research draft');
  ba.enqueueBusyTurnMessage('same', 'research queue');
  ra.saveChatRecovery('same', { lastEventId: 12, streaming: 'research answer', reasoning: '', activity: [], events: [] });
  pa.updateUiPreferences({ chatFontSize: 'xl' });
  expect(qa.queryKeys.sessions.detail('same').slice(0, 2)).toEqual(['profile', 'research']);
  history.replaceState(null, '', '/p/writer/chats/same'); vi.resetModules();
  const b = await import('./composerDrafts');
  const qb = await import('../api/queryKeys');
  expect(b.loadComposerDraft('same')).toBe('');
  expect((await import('./chatRecovery')).loadChatRecovery('same')).toBeNull();
  expect((await import('./busyTurnQueue')).loadBusyTurnQueue('same')).toEqual([]);
  expect(qb.queryKeys.sessions.detail('same')).not.toEqual(qa.queryKeys.sessions.detail('same'));
  b.saveComposerDraft('same', 'writer draft');
  // A late response from the first document still writes only to research.
  a.saveComposerDraft('same', 'late research draft');
  expect(b.loadComposerDraft('same')).toBe('writer draft');
  expect(a.loadComposerDraft('same')).toBe('late research draft');
  expect(localStorage.getItem('astra.profile.writer:astra.ui-preferences.v1')).toBeNull();
});

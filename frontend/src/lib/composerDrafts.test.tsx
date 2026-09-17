import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadComposerDraft, saveComposerDraft, useComposerDraft } from './composerDrafts';

describe('composer drafts', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips exact draft text and removes empty drafts', () => {
    saveComposerDraft('session-1', '  unfinished message\n', 1_000);
    expect(loadComposerDraft('session-1')).toBe('  unfinished message\n');

    saveComposerDraft('session-1', '');
    expect(loadComposerDraft('session-1')).toBe('');
  });

  it('restores drafts independently when the active session changes', () => {
    saveComposerDraft('one', 'first draft');
    saveComposerDraft('two', 'second draft');
    const { result, rerender } = renderHook(
      ({ sessionId }) => useComposerDraft(sessionId),
      { initialProps: { sessionId: 'one' } },
    );

    expect(result.current[0]).toBe('first draft');
    act(() => result.current[1]('updated first draft'));
    expect(loadComposerDraft('one')).toBe('updated first draft');

    rerender({ sessionId: 'two' });
    expect(result.current[0]).toBe('second draft');
    expect(loadComposerDraft('two')).toBe('second draft');
  });

  it('ignores malformed browser storage', () => {
    localStorage.setItem('astra.chat.composer-drafts.v1', '{not-json');
    expect(loadComposerDraft('session-1')).toBe('');
  });

  it('bounds storage to the fifty most recently updated drafts', () => {
    for (let index = 0; index < 51; index += 1) {
      saveComposerDraft(`session-${index}`, `draft ${index}`, 1_000 + index);
    }

    expect(loadComposerDraft('session-0')).toBe('');
    expect(loadComposerDraft('session-50')).toBe('draft 50');
  });
});

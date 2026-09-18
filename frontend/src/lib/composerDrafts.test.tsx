import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadComposerDraft, saveComposerDraft, useComposerDraft } from './composerDrafts';

describe('composer drafts', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('debounces storage writes while keeping the current text available', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useComposerDraft('one'));
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => result.current[1]('a'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current[1]('ab'));
    act(() => vi.advanceTimersByTime(200));
    expect(write).not.toHaveBeenCalled();
    expect(loadComposerDraft('one')).toBe('ab');
    act(() => vi.advanceTimersByTime(200));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('astra.chat.composer-drafts.v1')!).one.text).toBe('ab');
    unmount();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flushes the correct session on navigation, page exit, and unmount', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ sessionId }) => useComposerDraft(sessionId), { initialProps: { sessionId: 'one' } },
    );
    const stored = () => JSON.parse(localStorage.getItem('astra.chat.composer-drafts.v1') ?? '{}');
    act(() => result.current[1]('first'));
    rerender({ sessionId: 'two' });
    expect(stored().one.text).toBe('first');
    act(() => result.current[1]('second'));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(stored().two.text).toBe('second');
    act(() => result.current[1]('last edit'));
    unmount();
    expect(stored().two.text).toBe('last edit');
  });

  it('does not resurrect a cleared or deleted draft from a pending write', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useComposerDraft('one'));
    act(() => result.current[1]('send this'));
    act(() => result.current[1](''));
    act(() => vi.advanceTimersByTime(500));
    expect(loadComposerDraft('one')).toBe('');
    act(() => result.current[1]('delete this session'));
    saveComposerDraft('one', '');
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(loadComposerDraft('one')).toBe('');
  });

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

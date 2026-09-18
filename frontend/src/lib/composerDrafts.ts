import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

const STORAGE_KEY = 'astra.chat.composer-drafts.v1';
const MAX_DRAFTS = 50;
const SAVE_DELAY_MS = 400;
// Pending text is available across route changes before the debounced storage write.
const pendingDrafts = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>();

interface StoredDraft {
  text: string;
  updatedAt: number;
}

type DraftMap = Record<string, StoredDraft>;

function readDrafts(): DraftMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, StoredDraft] => {
        const value = entry[1];
        return value !== null
          && typeof value === 'object'
          && typeof (value as StoredDraft).text === 'string'
          && typeof (value as StoredDraft).updatedAt === 'number';
      }),
    );
  } catch {
    return {};
  }
}

function writeDrafts(drafts: DraftMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(drafts).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Draft persistence is best-effort when browser storage is unavailable or full.
  }
}

export function loadComposerDraft(sessionId: string): string {
  if (!sessionId) return '';
  return pendingDrafts.get(sessionId)?.text ?? readDrafts()[sessionId]?.text ?? '';
}

export function saveComposerDraft(sessionId: string, text: string, now = Date.now()) {
  if (!sessionId) return;
  const pending = pendingDrafts.get(sessionId);
  if (pending) clearTimeout(pending.timer);
  pendingDrafts.delete(sessionId);
  const drafts = readDrafts();
  if (text === '') {
    if (!(sessionId in drafts)) return;
    delete drafts[sessionId];
    writeDrafts(drafts);
    return;
  }

  drafts[sessionId] = { text, updatedAt: now };
  writeDrafts(Object.fromEntries(
    Object.entries(drafts)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_DRAFTS),
  ));
}

function flushDraft(sessionId: string) {
  const pending = pendingDrafts.get(sessionId);
  if (pending) saveComposerDraft(sessionId, pending.text);
}

/** Keeps composer text synchronized with the draft belonging to the active session. */
export function useComposerDraft(sessionId: string): [string, Dispatch<SetStateAction<string>>] {
  const storedDraft = useMemo(() => loadComposerDraft(sessionId), [sessionId]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({
    [sessionId]: storedDraft,
  }));
  const draft = drafts[sessionId] ?? storedDraft;

  useEffect(() => {
    if (!sessionId) return;
    // Clearing after sending must be durable immediately, including when the page closes.
    if (draft === '') {
      saveComposerDraft(sessionId, draft);
      return;
    }
    const pending = pendingDrafts.get(sessionId);
    if (pending) clearTimeout(pending.timer);
    pendingDrafts.set(sessionId, {
      text: draft,
      timer: setTimeout(() => flushDraft(sessionId), SAVE_DELAY_MS),
    });
  }, [sessionId, draft]);

  useEffect(() => {
    const flush = () => flushDraft(sessionId);
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, [sessionId]);

  const setDraft = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setDrafts((previous) => {
      const current = previous[sessionId] ?? loadComposerDraft(sessionId);
      return { ...previous, [sessionId]: typeof next === 'function' ? next(current) : next };
    });
  }, [sessionId]);

  return [draft, setDraft];
}

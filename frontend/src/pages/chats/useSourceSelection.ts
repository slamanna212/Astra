import { useCallback, useState } from 'react';
import { profileStorageKey } from '../../lib/profileScope';
import { DEFAULT_SOURCES, normalizeSources } from '../../lib/sources';

const STORAGE_KEY = 'sessionList.sources';

function readStoredSources(): string[] {
  try {
    const raw = localStorage.getItem(profileStorageKey(STORAGE_KEY));
    if (raw === null) return [...DEFAULT_SOURCES];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) return [...DEFAULT_SOURCES];
    // An empty stored selection is a deliberate choice; one that only held since-removed ids is not.
    const known = normalizeSources(parsed);
    return known.length || parsed.length === 0 ? known : [...DEFAULT_SOURCES];
  } catch {
    return [...DEFAULT_SOURCES];
  }
}

/** The session-type selection, remembered per browser and profile. UI-only; never sent anywhere but the list query. */
export function useSourceSelection(): [string[], (next: readonly string[]) => void] {
  const [sources, setSourcesState] = useState<string[]>(readStoredSources);
  const setSources = useCallback((next: readonly string[]) => {
    const normalized = normalizeSources(next);
    setSourcesState(normalized);
    try {
      localStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(normalized));
    } catch {
      // Storage unavailable (private mode, quota): the selection still applies for this visit.
    }
  }, []);
  return [sources, setSources];
}

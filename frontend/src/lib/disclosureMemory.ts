import { useCallback, useState } from 'react';

/**
 * Open/closed state for transcript disclosures, kept outside the component tree. Rows in a
 * virtualized list unmount when they scroll away, and a live activity group is re-rendered under
 * its saved row once history takes over; neither should silently collapse what the reader opened.
 */
const MAX_ENTRIES = 2_000;
const remembered = new Map<string, boolean>();

function remember(key: string, value: boolean) {
  remembered.delete(key);
  remembered.set(key, value);
  if (remembered.size > MAX_ENTRIES) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

export function useRememberedDisclosure(key: string, defaultOpen: boolean): [boolean, () => void] {
  const [local, setLocal] = useState<{ key: string; open: boolean } | null>(null);
  const stored = remembered.get(key);
  const open = local?.key === key ? local.open : (stored ?? defaultOpen);
  const toggle = useCallback(() => {
    const next = !open;
    remember(key, next);
    setLocal({ key, open: next });
  }, [key, open]);
  return [open, toggle];
}

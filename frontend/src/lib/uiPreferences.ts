import { useSyncExternalStore } from 'react';

/**
 * UI-only preferences. This intentionally lives in browser localStorage, under an
 * Astra-specific key, and has no API capable of accepting conversation content.
 */
export interface UiPreferences {
  sidebarDesktopCollapsed: boolean;
  cronAdvancedOpen: boolean;
}

const KEY = 'astra.ui-preferences.v1';
const DEFAULTS: UiPreferences = { sidebarDesktopCollapsed: false, cronAdvancedOpen: true };
let current = read();
const listeners = new Set<() => void>();

function read(): UiPreferences {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiPreferences>;
    return {
      sidebarDesktopCollapsed: value.sidebarDesktopCollapsed === true,
      cronAdvancedOpen: value.cronAdvancedOpen !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

export function updateUiPreferences(patch: Partial<UiPreferences>) {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
}

export function useUiPreferences(): UiPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => DEFAULTS,
  );
}

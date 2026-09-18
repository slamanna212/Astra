import { useSyncExternalStore } from 'react';

/**
 * UI-only preferences. This intentionally lives in browser localStorage, under an
 * Astra-specific key, and has no API capable of accepting conversation content.
 */
export type ChatFontSize = 'sm' | 'md' | 'lg' | 'xl';
export type BusyTurnMode = 'queue' | 'interrupt' | 'steer';
export type ActivityDisplayMode = 'transparent_stream' | 'compact_worklog';

/** Point sizes the chat transcript/composer render at for each ChatFontSize setting. */
export const CHAT_FONT_SIZES: Record<ChatFontSize, number> = { sm: 13, md: 14, lg: 16, xl: 18 };

export interface UiPreferences {
  cronAdvancedOpen: boolean;
  chatFontSize: ChatFontSize;
  busyTurnMode: BusyTurnMode;
  activityDisplayMode: ActivityDisplayMode;
}

const KEY = 'astra.ui-preferences.v1';
const DEFAULTS: UiPreferences = {
  cronAdvancedOpen: true,
  chatFontSize: 'md',
  busyTurnMode: 'steer',
  activityDisplayMode: 'transparent_stream',
};
let current = read();
const listeners = new Set<() => void>();

function read(): UiPreferences {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiPreferences>;
    return {
      cronAdvancedOpen: value.cronAdvancedOpen !== false,
      chatFontSize: value.chatFontSize && value.chatFontSize in CHAT_FONT_SIZES ? value.chatFontSize : DEFAULTS.chatFontSize,
      busyTurnMode: value.busyTurnMode === 'queue' || value.busyTurnMode === 'interrupt' || value.busyTurnMode === 'steer'
        ? value.busyTurnMode
        : DEFAULTS.busyTurnMode,
      activityDisplayMode: value.activityDisplayMode === 'compact_worklog' || value.activityDisplayMode === 'transparent_stream'
        ? value.activityDisplayMode
        : DEFAULTS.activityDisplayMode,
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

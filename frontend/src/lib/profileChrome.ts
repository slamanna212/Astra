import { profileStorageKey } from './profileScope';

/**
 * Per-profile chrome colour: the header + navbar take the current profile's colour so you can
 * tell at a glance which bot's document you are in. Content surfaces, buttons and status
 * colours never change — only the `--astra-chrome-*` tokens from tokens.css are overridden.
 *
 * An unset colour removes the overrides, so the default chrome is exactly tokens.css' teal.
 */

/** tokens.css `--astra-chrome-bg` (= teal-8). Also the `theme-color` in index.html. */
export const DEFAULT_CHROME_COLOR = '#0f7885';

/** Curated presets that read well as chrome in both colour schemes. */
export const CHROME_SWATCHES = [
  DEFAULT_CHROME_COLOR,
  '#1f6feb',
  '#5b4bc4',
  '#9c36b5',
  '#b0306a',
  '#c9495a',
  '#c2571a',
  '#e0a93f',
  '#2f8267',
  '#4a5159',
];

const HEX = /^#[0-9a-f]{6}$/i;
const DARK_INK = '#101418';
const STORAGE_KEY = profileStorageKey('chrome-color');

export function isChromeColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whether text on `hex` should be dark ink rather than white (whichever contrasts more). */
export function prefersDarkInk(hex: string): boolean {
  const bg = luminance(hex);
  return contrast(bg, luminance(DARK_INK)) > contrast(bg, 1);
}

/** The full chrome token set for one background colour. */
export function chromeTokens(color: string): Record<string, string> {
  const bg = color.toLowerCase();
  if (prefersDarkInk(bg)) {
    return {
      '--astra-chrome-bg': bg,
      '--astra-chrome-text': DARK_INK,
      '--astra-chrome-text-dim': 'rgba(16, 20, 24, .72)',
      '--astra-chrome-hover': 'rgba(0, 0, 0, .08)',
      '--astra-chrome-active-bg': 'rgba(16, 20, 24, .88)',
      '--astra-chrome-active-text': bg,
      '--astra-chrome-border': 'rgba(0, 0, 0, .16)',
      '--astra-chrome-search-bg': 'rgba(0, 0, 0, .07)',
      '--astra-chrome-card-bg': 'rgba(0, 0, 0, .05)',
    };
  }
  return {
    '--astra-chrome-bg': bg,
    '--astra-chrome-text': '#ffffff',
    '--astra-chrome-text-dim': 'rgba(255, 255, 255, .72)',
    '--astra-chrome-hover': 'rgba(255, 255, 255, .12)',
    '--astra-chrome-active-bg': 'rgba(255, 255, 255, .95)',
    '--astra-chrome-active-text': bg,
    '--astra-chrome-border': 'rgba(255, 255, 255, .18)',
    '--astra-chrome-search-bg': 'rgba(255, 255, 255, .13)',
    '--astra-chrome-card-bg': 'rgba(255, 255, 255, .06)',
  };
}

const TOKEN_NAMES = Object.keys(chromeTokens(DEFAULT_CHROME_COLOR));

/**
 * Paint the chrome. `null` (or anything that is not `#rrggbb`) restores the default teal.
 * `persist` remembers the colour for this profile so the next load paints before the roster
 * arrives; previews pass `false`.
 */
export function applyChromeColor(color: string | null | undefined, { persist = true } = {}): void {
  const valid = isChromeColor(color) ? color.toLowerCase() : null;
  const style = document.documentElement.style;
  if (valid) {
    for (const [name, value] of Object.entries(chromeTokens(valid))) style.setProperty(name, value);
  } else {
    for (const name of TOKEN_NAMES) style.removeProperty(name);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', valid ?? DEFAULT_CHROME_COLOR);
  if (!persist) return;
  try {
    if (valid) localStorage.setItem(STORAGE_KEY, valid);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the roster still paints the right colour once it loads.
  }
}

/** Paint the last known colour for this profile before React mounts (no teal flash on switch). */
export function applyCachedChromeColor(): void {
  let cached: string | null;
  try {
    cached = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (isChromeColor(cached)) applyChromeColor(cached, { persist: false });
}

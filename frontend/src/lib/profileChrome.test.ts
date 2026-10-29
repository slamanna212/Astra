import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCachedChromeColor,
  applyChromeColor,
  chromeTokens,
  DEFAULT_CHROME_COLOR,
  isChromeColor,
  prefersDarkInk,
} from './profileChrome';
import { profileStorageKey } from './profileScope';

const root = () => document.documentElement.style;
const KEY = profileStorageKey('chrome-color');

describe('profile chrome', () => {
  afterEach(() => {
    applyChromeColor(null);
    document.head.innerHTML = '';
    localStorage.clear();
  });

  it('accepts only #rrggbb', () => {
    expect(isChromeColor('#C9495A')).toBe(true);
    for (const bad of ['red', '#fff', '#c9495a; x', 'url(#a)', null, undefined, 42]) {
      expect(isChromeColor(bad)).toBe(false);
    }
  });

  it('picks readable ink for dark, mid and light colours', () => {
    expect(prefersDarkInk(DEFAULT_CHROME_COLOR)).toBe(false);
    expect(prefersDarkInk('#0e1013')).toBe(false);
    expect(prefersDarkInk('#c9495a')).toBe(false);
    expect(prefersDarkInk('#e0a93f')).toBe(true);
    expect(prefersDarkInk('#ffffff')).toBe(true);
    expect(chromeTokens('#E0A93F')['--astra-chrome-text']).toBe('#101418');
    expect(chromeTokens('#E0A93F')['--astra-chrome-active-text']).toBe('#e0a93f');
    expect(chromeTokens('#1f6feb')['--astra-chrome-text']).toBe('#ffffff');
  });

  it('overrides the chrome tokens and theme-color, and null restores tokens.css', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#0F7885">';
    applyChromeColor('#C9495A');
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('#c9495a');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#c9495a');
    expect(localStorage.getItem(KEY)).toBe('#c9495a');

    applyChromeColor(null);
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('');
    expect(root().getPropertyValue('--astra-chrome-text')).toBe('');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(DEFAULT_CHROME_COLOR);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('previews without persisting, and ignores junk', () => {
    applyChromeColor('#2f8267', { persist: false });
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('#2f8267');
    expect(localStorage.getItem(KEY)).toBeNull();
    applyChromeColor('javascript:alert(1)', { persist: false });
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('');
  });

  it('paints the cached colour on boot', () => {
    localStorage.setItem(KEY, '#5b4bc4');
    applyCachedChromeColor();
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('#5b4bc4');
    localStorage.setItem(KEY, 'not a colour');
    applyChromeColor(null, { persist: false });
    applyCachedChromeColor();
    expect(root().getPropertyValue('--astra-chrome-bg')).toBe('');
  });
});

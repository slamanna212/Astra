import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCost,
  formatCount,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
  formatTokens,
  sessionTitle,
} from './format';

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

describe('formatRelativeTime', () => {
  it('handles recent times', () => {
    expect(formatRelativeTime(NOW_S - 5, NOW_MS)).toBe('just now');
    expect(formatRelativeTime(NOW_S - 60, NOW_MS)).toBe('1m ago');
    expect(formatRelativeTime(NOW_S - 59 * 60, NOW_MS)).toBe('59m ago');
    expect(formatRelativeTime(NOW_S - 3 * 3600, NOW_MS)).toBe('3h ago');
    expect(formatRelativeTime(NOW_S - 2 * 86400 - 10, NOW_MS)).toBe('2d ago');
  });

  it('accepts fractional epoch seconds and clamps the future', () => {
    expect(formatRelativeTime(NOW_S - 125.75, NOW_MS)).toBe('2m ago');
    expect(formatRelativeTime(NOW_S + 3600, NOW_MS)).toBe('just now');
  });

  it('falls back to a date beyond a week', () => {
    const old = formatRelativeTime(NOW_S - 30 * 86400, NOW_MS);
    expect(old).not.toMatch(/ago/);
    expect(old).not.toMatch(/2026/);
    expect(formatRelativeTime(Date.UTC(2024, 2, 4, 12) / 1000, NOW_MS)).toMatch(/2024/);
  });

  it('handles missing values', () => {
    expect(formatRelativeTime(null, NOW_MS)).toBe('—');
    expect(formatRelativeTime(undefined, NOW_MS)).toBe('—');
    expect(formatRelativeTime(Number.NaN, NOW_MS)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats seconds, not milliseconds', () => {
    expect(formatDateTime(NOW_S)).toMatch(/2026/);
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [45_600, '45.6k'],
    [123_456, '123k'],
    [999_999, '1M'],
    [1_250_000, '1.25M'],
    [3_000_000_000, '3B'],
  ])('%d → %s', (input, expected) => {
    expect(formatTokens(input)).toBe(expected);
  });

  it('handles missing values', () => {
    expect(formatTokens(null)).toBe('—');
  });
});

describe('formatCost', () => {
  it.each([
    [null, '—'],
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [1.234, '$1.23'],
    [1234.5, '$1,234.50'],
  ])('%s → %s', (input, expected) => {
    expect(formatCost(input)).toBe(expected);
  });
});

describe('formatCount', () => {
  it('adds separators', () => {
    expect(formatCount(4413)).toBe('4,413');
    expect(formatCount(undefined)).toBe('—');
  });
});

describe('formatPercent', () => {
  it.each([
    [0.36093885, 1, '36.1%'],
    [0, 1, '0.0%'],
    [1, 0, '100%'],
  ])('%s → %s', (input, digits, expected) => {
    expect(formatPercent(input, digits)).toBe(expected);
  });

  it('handles missing values', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
  });
});

describe('formatShortDate', () => {
  it('formats an ISO date without a timezone shift', () => {
    expect(formatShortDate('2026-09-15')).toBe('Sep 15');
    expect(formatShortDate('2026-01-01')).toBe('Jan 1');
  });

  it('falls back to the raw string for malformed input', () => {
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
  });
});

describe('sessionTitle', () => {
  it('falls back title → display_name → Untitled', () => {
    expect(sessionTitle({ title: 'Hello', display_name: 'D' })).toBe('Hello');
    expect(sessionTitle({ title: '  ', display_name: 'D' })).toBe('D');
    expect(sessionTitle({ title: null, display_name: null })).toBe('Untitled');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [11 * 1024 * 1024, '11 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('%s → %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('handles missing/invalid values', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../api/types';
import { filterLogEntries, guessLevel, levelColor, matchesFilter } from './logs';

function entry(overrides: Partial<LogEntry>): LogEntry {
  return {
    raw: 'raw',
    timestamp: null,
    level: null,
    logger: null,
    session: null,
    message: null,
    ...overrides,
  };
}

describe('levelColor', () => {
  it('maps known levels to a colour, case-insensitively', () => {
    expect(levelColor('INFO')).toBe('teal');
    expect(levelColor('warning')).toBe('sand');
    expect(levelColor('ERROR')).toBe('red');
    expect(levelColor('CRITICAL')).toBe('red');
    expect(levelColor('DEBUG')).toBe('gray');
  });

  it('falls back to gray for null/unknown', () => {
    expect(levelColor(null)).toBe('gray');
    expect(levelColor(undefined)).toBe('gray');
    expect(levelColor('TOTALLY_UNKNOWN')).toBe('gray');
  });
});

describe('guessLevel', () => {
  it('extracts a level keyword from a raw line', () => {
    expect(guessLevel('2026-09-15 20:55:52,178 WARNING tools.x: Token refresh failed')).toBe('WARNING');
    expect(guessLevel('  File "example.py", line 1, in <module>')).toBeNull();
  });
});

describe('matchesFilter / filterLogEntries', () => {
  const entries = [
    entry({ raw: 'INFO hello world', level: 'INFO' }),
    entry({ raw: 'WARNING token refresh failed', level: 'WARNING' }),
    entry({ raw: '  traceback continuation line', level: null }),
  ];

  it('with no filter, matches everything', () => {
    expect(filterLogEntries(entries, {})).toEqual(entries);
  });

  it('filters by level, case-insensitively', () => {
    expect(filterLogEntries(entries, { level: 'warning' })).toEqual([entries[1]]);
  });

  it('filters by case-insensitive substring search over the raw line', () => {
    expect(filterLogEntries(entries, { search: 'TOKEN' })).toEqual([entries[1]]);
    expect(filterLogEntries(entries, { search: 'traceback' })).toEqual([entries[2]]);
  });

  it('combines level and search', () => {
    expect(filterLogEntries(entries, { level: 'INFO', search: 'hello' })).toEqual([entries[0]]);
    expect(filterLogEntries(entries, { level: 'INFO', search: 'nope' })).toEqual([]);
  });

  it('matchesFilter agrees with filterLogEntries element-wise', () => {
    for (const e of entries) {
      expect(matchesFilter(e, { level: 'WARNING' })).toBe(filterLogEntries(entries, { level: 'WARNING' }).includes(e));
    }
  });
});

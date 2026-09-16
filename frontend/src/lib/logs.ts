/**
 * Client-side log helpers: level colouring and filtering the already-fetched window instantly
 * (the server also applies `level`/`search` when tailing — see astra/logs.py — this just makes
 * the UI feel instant while a refetch/reconnect with the new filters is in flight).
 */

import type { LogEntry } from '../api/types';

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'gray',
  INFO: 'teal',
  WARNING: 'sand',
  WARN: 'sand',
  ERROR: 'red',
  CRITICAL: 'red',
};

export function levelColor(level: string | null | undefined): string {
  if (!level) return 'gray';
  return LEVEL_COLORS[level.toUpperCase()] ?? 'gray';
}

const LEVEL_IN_RAW_RE = /\b(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\b/;

/** Best-effort level extraction for a raw line the backend could not parse (e.g. a traceback
 * continuation line) — used only to decide whether to still tint it, never sent back to the server. */
export function guessLevel(raw: string): string | null {
  const match = LEVEL_IN_RAW_RE.exec(raw);
  return match ? match[1]! : null;
}

export interface LogFilter {
  level?: string | null;
  search?: string | null;
}

export function matchesFilter(entry: Pick<LogEntry, 'level' | 'raw'>, filter: LogFilter): boolean {
  if (filter.level && (entry.level ?? '').toUpperCase() !== filter.level.toUpperCase()) return false;
  if (filter.search && !entry.raw.toLowerCase().includes(filter.search.toLowerCase())) return false;
  return true;
}

export function filterLogEntries<T extends Pick<LogEntry, 'level' | 'raw'>>(entries: T[], filter: LogFilter): T[] {
  if (!filter.level && !filter.search) return entries;
  return entries.filter((e) => matchesFilter(e, filter));
}

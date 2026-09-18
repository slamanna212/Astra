/** Small, dependency-free formatting helpers. Backend timestamps are epoch SECONDS. */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Compact relative time: "just now", "5m ago", "3h ago", "2d ago"; older than a week renders a
 * short date ("Mar 4", or "Mar 4, 2024" when not in the current year). Future times are clamped.
 */
export function formatRelativeTime(epochSeconds: number | null | undefined, nowMs: number = Date.now()): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds)) return '—';
  const diff = Math.max(0, nowMs / 1000 - epochSeconds);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  const date = new Date(epochSeconds * 1000);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Ultra-compact age, no "ago" suffix, for fixed-width list columns: "5m", "3h", "2d", "1w".
 * Beyond ~4 weeks falls back to a short date so it never overflows a narrow column.
 */
export function formatCompactAge(epochSeconds: number | null | undefined, nowMs: number = Date.now()): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds)) return '—';
  const diff = Math.max(0, nowMs / 1000 - epochSeconds);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < 4 * WEEK) return `${Math.floor(diff / WEEK)}w`;
  return formatRelativeTime(epochSeconds, nowMs);
}

/**
 * Group label for a session-list date header: "Today", "Yesterday", or a short date
 * ("Sep 15", "Sep 15, 2025" if not the current year) — bucketed by local calendar day,
 * not a rolling 24h window.
 */
export function formatGroupDate(epochSeconds: number, nowMs: number = Date.now()): string {
  const date = new Date(epochSeconds * 1000);
  const now = new Date(nowMs);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (DAY * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Absolute local date-time for tooltips/detail views. */
export function formatDateTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds)) return '—';
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1');
}

/** Token counts: 999 → "999", 1234 → "1.2k", 45_600 → "45.6k", 1_250_000 → "1.25M". */
export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return '—';
  const n = Math.max(0, Math.round(count));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    // Avoid "1000k" at the boundary.
    if (k >= 999.95) return `${trimFixed(n / 1_000_000, 2)}M`;
    return `${trimFixed(k, k < 100 ? 1 : 0)}k`;
  }
  if (n < 1_000_000_000) return `${trimFixed(n / 1_000_000, 2)}M`;
  return `${trimFixed(n / 1_000_000_000, 2)}B`;
}

/** USD cost: null → "—", 0 → "$0.00", 0.004 → "<$0.01", 1.234 → "$1.23", 1234.5 → "$1,234.50". */
export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Token generation speed: 47.3 → "47.3 tok/s", null → "—". */
export function formatTps(tps: number | null | undefined): string {
  if (tps === null || tps === undefined || !Number.isFinite(tps) || tps <= 0) return '—';
  return `${trimFixed(tps, 1)} tok/s`;
}

/** Integer with thousands separators: 4413 → "4,413". */
export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(count));
}

/** Fraction in [0, 1] as a percentage: 0.3609 → "36.1%", null → "—". */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A "YYYY-MM-DD" date string (as returned by /api/insights) as a short chart-axis label: "Sep 15". */
export function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  // Noon UTC avoids any DST/timezone edge shifting the calendar day when rendered locally.
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Session title with fallbacks: title → display_name → "Untitled". */
export function sessionTitle(session: { title: string | null; display_name: string | null }): string {
  const title = session.title?.trim();
  if (title) return title;
  const display = session.display_name?.trim();
  if (display) return display;
  return 'Untitled';
}

/** Byte counts for the Files browser: 0 → "0 B", 1536 → "1.5 KB", 1_048_576 → "1 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${trimFixed(value, value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

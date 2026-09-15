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

/** Integer with thousands separators: 4413 → "4,413". */
export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(count));
}

/** Session title with fallbacks: title → display_name → "Untitled". */
export function sessionTitle(session: { title: string | null; display_name: string | null }): string {
  const title = session.title?.trim();
  if (title) return title;
  const display = session.display_name?.trim();
  if (display) return display;
  return 'Untitled';
}

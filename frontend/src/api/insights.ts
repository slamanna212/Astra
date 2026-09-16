import { apiFetch } from './client';
import type { InsightsRange, InsightsResponse } from './types';

/** The browser's IANA zone name (e.g. "America/New_York"), falling back to UTC. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getInsights(
  days: InsightsRange,
  tz: string = browserTimeZone(),
  signal?: AbortSignal,
): Promise<InsightsResponse> {
  return apiFetch<InsightsResponse>('/insights', { signal, query: { days, tz } });
}

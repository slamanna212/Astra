import { apiFetch, buildUrl } from './client';
import type { LogTailResponse } from './types';

export interface LogTailParams {
  file: string;
  lines?: number;
  level?: string | null;
  search?: string | null;
}

export function getLogTail({ file, lines, level, search }: LogTailParams, signal?: AbortSignal): Promise<LogTailResponse> {
  return apiFetch<LogTailResponse>('/logs', {
    signal,
    query: { file, lines, level: level || undefined, search: search || undefined },
  });
}

/** SSE URL for `EventSource` — not fetched via apiFetch (that wrapper isn't for streaming responses). */
export function logStreamUrl({ file, level, search }: LogTailParams): string {
  return buildUrl('/logs/stream', { file, level: level || undefined, search: search || undefined });
}

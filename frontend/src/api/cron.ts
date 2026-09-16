import { apiFetch, buildUrl } from './client';
import type { CronJob, CronJobPage, CronOutputContent, CronOutputPage, CronScriptField } from './types';

export function listCronJobs(signal?: AbortSignal): Promise<CronJobPage> {
  return apiFetch<CronJobPage>('/cron', { signal });
}

export function getCronJob(id: string, signal?: AbortSignal): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}`, { signal });
}

export type CronScriptFieldName = 'script' | 'post_script' | 'monitor_script';

export function getCronJobScript(
  id: string,
  field: CronScriptFieldName,
  signal?: AbortSignal,
): Promise<CronScriptField> {
  return apiFetch<CronScriptField>(`/cron/${encodeURIComponent(id)}/script/${field}`, { signal });
}

export function listCronJobOutput(
  id: string,
  params: { limit?: number; cursor?: string | null } = {},
  signal?: AbortSignal,
): Promise<CronOutputPage> {
  return apiFetch<CronOutputPage>(`/cron/${encodeURIComponent(id)}/output`, {
    signal,
    query: { limit: params.limit, cursor: params.cursor },
  });
}

export function getCronJobOutput(id: string, run: string, signal?: AbortSignal): Promise<CronOutputContent> {
  return apiFetch<CronOutputContent>(`/cron/${encodeURIComponent(id)}/output/${encodeURIComponent(run)}`, {
    signal,
  });
}

/** SSE URL for `EventSource` — not fetched via apiFetch (that wrapper isn't for streaming responses). */
export function cronEventsUrl(): string {
  return buildUrl('/cron/events');
}

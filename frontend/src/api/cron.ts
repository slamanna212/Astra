import { apiFetch, buildUrl } from './client';
import type { CronJob, CronJobPage, CronOutputContent, CronOutputPage, CronScriptField } from './types';

export interface CronWriteInput {
  schedule: string;
  name?: string | null;
  prompt?: string | null;
  deliver?: string | null;
  skills?: string[] | null;
  repeat?: number | null;
  script?: string | null;
  post_script?: string | null;
  no_agent?: boolean;
  context_from?: string[] | null;
  attach_to_session?: boolean | null;
  monitor_script?: string | null;
  monitor_url?: string | null;
  workdir?: string | null;
  model?: string | null;
  provider?: string | null;
  reasoning_effort?: string | null;
  enabled_toolsets?: string[] | null;
}

export function listCronJobs(signal?: AbortSignal): Promise<CronJobPage> {
  return apiFetch<CronJobPage>('/cron', { signal });
}

export function getCronJob(id: string, signal?: AbortSignal): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}`, { signal });
}

export function createCronJob(input: CronWriteInput): Promise<CronJob> {
  return apiFetch<CronJob>('/cron', { method: 'POST', body: input });
}

export function updateCronJob(id: string, input: Partial<CronWriteInput>): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
}

export function deleteCronJob(id: string): Promise<void> {
  return apiFetch<void>(`/cron/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function runCronJob(id: string): Promise<{ accepted: boolean }> {
  return apiFetch<{ accepted: boolean }>(`/cron/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export function pauseCronJob(id: string, reason?: string): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
    body: { reason: reason || null },
  });
}

export function resumeCronJob(id: string): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}/resume`, { method: 'POST' });
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

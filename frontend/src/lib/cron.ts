/** Formatting helpers for the Scheduled tasks (cron) screens. See BUILD-SPEC §4.5, §5.4. */

import type { CronJob } from '../api/types';

/**
 * Human-readable schedule. The backend's `schedule_display` (Hermes' own
 * `cron.jobs._normalize_job_record`) already covers every real record, but this falls back to
 * the raw `schedule.kind` shape defensively (e.g. a hand-edited or pre-normalization record).
 */
export function humanSchedule(job: Pick<CronJob, 'schedule_display' | 'schedule'>): string {
  const display = job.schedule_display?.trim();
  if (display) return display;
  const schedule = job.schedule;
  if (!schedule || typeof schedule !== 'object') return '—';
  const kind = schedule.kind;
  if (kind === 'cron' && typeof schedule.expr === 'string') return schedule.expr;
  if (kind === 'interval' && typeof schedule.minutes === 'number') return `every ${schedule.minutes}m`;
  if (kind === 'once' && typeof schedule.run_at === 'string') return `once at ${schedule.run_at}`;
  return '—';
}

export type BadgeTone = 'gray' | 'teal' | 'green' | 'red' | 'sand';

export interface StatusBadge {
  label: string;
  color: BadgeTone;
}

/** Effective job state badge — mirrors `cron.jobs.effective_job_state`'s precedence: a
 * terminal state wins, then a pause marker, then `enabled`, defaulting to "scheduled". */
export function jobStateBadge(job: Pick<CronJob, 'enabled' | 'state' | 'paused_at'>): StatusBadge {
  const state = (job.state ?? '').trim();
  if (state === 'completed') return { label: 'Completed', color: 'gray' };
  if (state === 'error') return { label: 'Error', color: 'red' };
  if (!job.enabled || state === 'paused' || job.paused_at) return { label: 'Paused', color: 'sand' };
  return { label: 'Scheduled', color: 'green' };
}

/** Badge for the most recent run's outcome (`last_status` — free-form, but "ok"/"success" and
 * "error"/"failed" are the values seen in practice). */
export function lastRunBadge(job: Pick<CronJob, 'last_status' | 'last_run_at'>): StatusBadge | null {
  if (!job.last_run_at) return null;
  const status = (job.last_status ?? '').toLowerCase();
  if (status === 'ok' || status === 'success') return { label: 'OK', color: 'green' };
  if (status === 'error' || status === 'failed') return { label: 'Failed', color: 'red' };
  if (!status) return null;
  return { label: status, color: 'gray' };
}

/** Delivery target: "local" | "discord" | "discord:#channel" -> a short display label. */
export function deliveryLabel(deliver: string | null | undefined): string {
  if (!deliver) return '—';
  const [target, detail] = deliver.split(':', 2);
  if (!detail) return target ?? deliver;
  return `${target} (${detail})`;
}

/** "3 / 10" or "3" when the repeat count is unbounded (`times: null`). */
export function repeatLabel(repeat: CronJob['repeat']): string {
  if (!repeat) return '—';
  const completed = repeat.completed ?? 0;
  return repeat.times === null || repeat.times === undefined ? `${completed}` : `${completed} / ${repeat.times}`;
}

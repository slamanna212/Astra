import { describe, expect, it } from 'vitest';
import { deliveryLabel, humanSchedule, jobStateBadge, lastRunBadge, repeatLabel } from './cron';

describe('humanSchedule', () => {
  it('prefers schedule_display', () => {
    expect(humanSchedule({ schedule_display: '50 10 * * *', schedule: null })).toBe('50 10 * * *');
  });

  it('falls back to a cron schedule dict', () => {
    expect(humanSchedule({ schedule_display: null, schedule: { kind: 'cron', expr: '0 9 * * *' } })).toBe(
      '0 9 * * *',
    );
  });

  it('falls back to an interval schedule dict', () => {
    expect(humanSchedule({ schedule_display: null, schedule: { kind: 'interval', minutes: 30 } })).toBe(
      'every 30m',
    );
  });

  it('falls back to a once schedule dict', () => {
    expect(
      humanSchedule({ schedule_display: null, schedule: { kind: 'once', run_at: '2026-01-01T00:00:00Z' } }),
    ).toBe('once at 2026-01-01T00:00:00Z');
  });

  it('renders — when nothing is available', () => {
    expect(humanSchedule({ schedule_display: null, schedule: null })).toBe('—');
  });
});

describe('jobStateBadge', () => {
  it('shows Scheduled for an enabled, unpaused job', () => {
    expect(jobStateBadge({ enabled: true, state: 'scheduled', paused_at: null })).toEqual({
      label: 'Scheduled',
      color: 'green',
    });
  });

  it('shows Paused when disabled, even without a state marker', () => {
    expect(jobStateBadge({ enabled: false, state: null, paused_at: null })).toEqual({
      label: 'Paused',
      color: 'yellow',
    });
  });

  it('shows Paused when paused_at is set even if enabled', () => {
    expect(jobStateBadge({ enabled: true, state: null, paused_at: '2026-01-01T00:00:00Z' })).toEqual({
      label: 'Paused',
      color: 'yellow',
    });
  });

  it('never shows paused when enabled=true overrides a stale "paused" state', () => {
    // Mirrors cron.jobs.effective_job_state: enabled=true is authoritative.
    expect(jobStateBadge({ enabled: true, state: 'paused', paused_at: null })).toEqual({
      label: 'Paused',
      color: 'yellow',
    });
  });

  it('shows a terminal state regardless of enabled', () => {
    expect(jobStateBadge({ enabled: true, state: 'completed', paused_at: null })).toEqual({
      label: 'Completed',
      color: 'gray',
    });
    expect(jobStateBadge({ enabled: false, state: 'error', paused_at: null })).toEqual({
      label: 'Error',
      color: 'red',
    });
  });
});

describe('lastRunBadge', () => {
  it('is null when the job has never run', () => {
    expect(lastRunBadge({ last_status: null, last_run_at: null })).toBeNull();
  });

  it('shows OK for a successful run', () => {
    expect(lastRunBadge({ last_status: 'ok', last_run_at: '2026-01-01T00:00:00Z' })).toEqual({
      label: 'OK',
      color: 'green',
    });
  });

  it('shows Failed for an error run', () => {
    expect(lastRunBadge({ last_status: 'error', last_run_at: '2026-01-01T00:00:00Z' })).toEqual({
      label: 'Failed',
      color: 'red',
    });
  });
});

describe('deliveryLabel', () => {
  it('renders a bare target as-is', () => {
    expect(deliveryLabel('local')).toBe('local');
  });

  it('renders target:detail with the detail in parens', () => {
    expect(deliveryLabel('discord:#hermes-main')).toBe('discord (#hermes-main)');
  });

  it('renders — for null', () => {
    expect(deliveryLabel(null)).toBe('—');
  });
});

describe('repeatLabel', () => {
  it('renders completed/times', () => {
    expect(repeatLabel({ times: 10, completed: 3 })).toBe('3 / 10');
  });

  it('renders just completed when times is unbounded', () => {
    expect(repeatLabel({ times: null, completed: 51 })).toBe('51');
  });

  it('renders — for null', () => {
    expect(repeatLabel(null)).toBe('—');
  });
});

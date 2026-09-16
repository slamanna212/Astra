/**
 * Grouping config for the cron job detail view. Exists as data (not JSX) so a test can assert
 * every field BUILD-SPEC §4.5 requires ("The UI must therefore expose at minimum: schedule,
 * name, prompt, deliver, skills, repeat, script, post_script, no_agent, context_from,
 * continuity, monitor_script, monitor_url, workdir, model, provider, reasoning_effort,
 * enabled_toolsets") is present — see cronDetailFields.test.ts. None of these fields can be
 * dropped by a refactor without that test failing.
 *
 * `aliases` covers spec field names that don't match the wire field 1:1 — BUILD-SPEC calls the
 * session-continuity flag "continuity"; the wire field (and Hermes' own cronjob tool) calls it
 * `attach_to_session`.
 */

export interface CronDetailField {
  key: string;
  label: string;
  aliases?: string[];
}

export interface CronDetailGroup {
  title: string;
  fields: CronDetailField[];
}

export const CRON_DETAIL_GROUPS: CronDetailGroup[] = [
  {
    title: 'Basics',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'id', label: 'ID' },
      { key: 'prompt', label: 'Prompt' },
      { key: 'created_at', label: 'Created' },
    ],
  },
  {
    title: 'Schedule',
    fields: [
      { key: 'schedule', label: 'Schedule' },
      { key: 'schedule_display', label: 'Schedule (human-readable)' },
      { key: 'repeat', label: 'Repeat' },
      { key: 'next_run_at', label: 'Next run' },
      { key: 'last_run_at', label: 'Last run' },
    ],
  },
  {
    title: 'Delivery',
    fields: [{ key: 'deliver', label: 'Deliver' }],
  },
  {
    title: 'Agent',
    fields: [
      { key: 'model', label: 'Model' },
      { key: 'provider', label: 'Provider' },
      { key: 'reasoning_effort', label: 'Reasoning effort' },
      { key: 'enabled_toolsets', label: 'Enabled toolsets' },
      { key: 'skills', label: 'Skills' },
    ],
  },
  {
    title: 'Scripts & hooks',
    fields: [
      { key: 'script', label: 'Script' },
      { key: 'post_script', label: 'Post script' },
      { key: 'monitor_script', label: 'Monitor script' },
      { key: 'monitor_url', label: 'Monitor URL' },
      { key: 'workdir', label: 'Working directory' },
      { key: 'no_agent', label: 'No agent (script only)' },
    ],
  },
  {
    title: 'Context',
    fields: [
      { key: 'context_from', label: 'Context from' },
      { key: 'attach_to_session', label: 'Continuity (attach to session)', aliases: ['continuity'] },
    ],
  },
  {
    title: 'State',
    fields: [
      { key: 'last_error', label: 'Last error' },
      { key: 'last_delivery_error', label: 'Last delivery error' },
      { key: 'failure_streak', label: 'Failure streak' },
      { key: 'last_status', label: 'Last run status' },
      { key: 'paused_reason', label: 'Paused reason' },
    ],
  },
];

/** Every BUILD-SPEC §4.5 field name that must be represented somewhere above (by `key` or
 * `aliases`, case-sensitive — the spec's own tokens). */
export const REQUIRED_SPEC_FIELDS = [
  'schedule',
  'name',
  'prompt',
  'deliver',
  'skills',
  'repeat',
  'script',
  'post_script',
  'no_agent',
  'context_from',
  'continuity',
  'monitor_script',
  'monitor_url',
  'workdir',
  'model',
  'provider',
  'reasoning_effort',
  'enabled_toolsets',
] as const;

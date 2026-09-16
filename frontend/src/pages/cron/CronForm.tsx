import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import type { CronWriteInput } from '../../api/cron';
import type { CronJob } from '../../api/types';
import { useUiPreferences, updateUiPreferences } from '../../lib/uiPreferences';

const PRESETS = [
  { value: '0 9 * * *', label: 'Daily at 09:00' },
  { value: '0 9 * * 1', label: 'Weekly, Monday at 09:00' },
  { value: '0 0 1 * *', label: 'Monthly, first day at midnight' },
  { value: '*/5 * * * *', label: 'Every 5 minutes (cron)' },
];

function scheduleText(job?: CronJob): string {
  const schedule = job?.schedule;
  if (!schedule) return '0 9 * * *';
  const display = schedule.display;
  const expr = schedule.expr;
  if (typeof display === 'string' && display) return display;
  if (typeof expr === 'string' && expr) return expr;
  return job?.schedule_display || '0 9 * * *';
}

function csv(value: string): string[] | null {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? values : null;
}

export function CronForm({
  job,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  job?: CronJob;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: CronWriteInput) => void;
  onCancel: () => void;
}) {
  const prefs = useUiPreferences();
  const [name, setName] = useState(job?.name ?? '');
  const [prompt, setPrompt] = useState(job?.prompt ?? '');
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'raw' | 'every'>('raw');
  const [schedule, setSchedule] = useState(scheduleText(job));
  const [every, setEvery] = useState('30m');
  const [deliver, setDeliver] = useState(job?.deliver ?? 'local');
  const [skills, setSkills] = useState(job?.skills ?? []);
  const [repeat, setRepeat] = useState<number | string>(job?.repeat?.times ?? '');
  const [script, setScript] = useState(job?.script ?? '');
  const [postScript, setPostScript] = useState(job?.post_script ?? '');
  const [monitorScript, setMonitorScript] = useState(job?.monitor_script ?? '');
  const [monitorUrl, setMonitorUrl] = useState(job?.monitor_url ?? '');
  const [workdir, setWorkdir] = useState(job?.workdir ?? '');
  const [noAgent, setNoAgent] = useState(job?.no_agent ?? false);
  const [contextFrom, setContextFrom] = useState((job?.context_from ?? []).join(', '));
  const [continuity, setContinuity] = useState(job?.attach_to_session ?? false);
  const [model, setModel] = useState(job?.model ?? '');
  const [provider, setProvider] = useState(job?.provider ?? '');
  const [reasoning, setReasoning] = useState(job?.reasoning_effort ?? '');
  const [toolsets, setToolsets] = useState(job?.enabled_toolsets ?? []);

  const effectiveSchedule = scheduleMode === 'every' ? `every ${every.trim()}` : schedule.trim();
  const hasPayload = name.trim().length > 0 || prompt.trim().length > 0 || script.trim().length > 0;
  const conflictingMonitors = Boolean(monitorScript.trim() && monitorUrl.trim());
  const valid = effectiveSchedule.length > 0 && hasPayload && !conflictingMonitors && (!noAgent || Boolean(script.trim()));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSubmit({
          schedule: effectiveSchedule,
          name: name.trim() || null,
          prompt: prompt || null,
          deliver: deliver || null,
          skills,
          repeat: typeof repeat === 'number' ? repeat : null,
          script: script.trim() || null,
          post_script: postScript.trim() || null,
          no_agent: noAgent,
          context_from: csv(contextFrom),
          attach_to_session: continuity,
          monitor_script: monitorScript.trim() || null,
          monitor_url: monitorUrl.trim() || null,
          workdir: workdir.trim() || null,
          model: model.trim() || null,
          provider: provider.trim() || null,
          reasoning_effort: reasoning || null,
          enabled_toolsets: toolsets,
        });
      }}
    >
      <Stack gap="md">
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Delivery target" description="For example: local, discord, or discord:#channel" value={deliver} onChange={(e) => setDeliver(e.currentTarget.value)} /></Grid.Col>
        </Grid>
        <Textarea label="Prompt" minRows={4} autosize value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} />

        <Divider label="Schedule" labelPosition="left" />
        <Select label="Schedule builder" value={scheduleMode} onChange={(value) => setScheduleMode((value ?? 'raw') as 'preset' | 'raw' | 'every')} data={[{ value: 'preset', label: 'Preset' }, { value: 'raw', label: 'Raw cron or date/time' }, { value: 'every', label: 'Recurring interval (every N)' }]} />
        {scheduleMode === 'preset' ? (
          <Select label="Preset" data={PRESETS} value={schedule} onChange={(value) => setSchedule(value ?? '')} searchable />
        ) : scheduleMode === 'every' ? (
          <TextInput label="Interval" description={`Saved as “every ${every || '…'}”`} placeholder="30m" value={every} onChange={(e) => setEvery(e.currentTarget.value)} />
        ) : (
          <TextInput required label="Schedule" placeholder="0 9 * * *" value={schedule} onChange={(e) => setSchedule(e.currentTarget.value)} />
        )}
        <Alert icon={<IconInfoCircle size={16} />} color="yellow" title="One-time vs recurring">
          A duration such as <code>30m</code> runs once. Use <code>every 30m</code> for a recurring task.
        </Alert>
        <NumberInput label="Repeat limit" description="Leave empty for unlimited runs" min={1} value={repeat} onChange={setRepeat} />

        <Group justify="space-between">
          <Text fw={600}>Advanced fields</Text>
          <Button variant="subtle" size="compact-sm" onClick={() => updateUiPreferences({ cronAdvancedOpen: !prefs.cronAdvancedOpen })}>
            {prefs.cronAdvancedOpen ? 'Hide' : 'Show'}
          </Button>
        </Group>
        {prefs.cronAdvancedOpen && (
          <Stack gap="md">
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Script" value={script} onChange={(e) => setScript(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Post script" value={postScript} onChange={(e) => setPostScript(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Monitor script" value={monitorScript} onChange={(e) => setMonitorScript(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Monitor URL" value={monitorUrl} onChange={(e) => setMonitorUrl(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Working directory" value={workdir} onChange={(e) => setWorkdir(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Context from" description="Comma-separated job IDs or self" value={contextFrom} onChange={(e) => setContextFrom(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Model" value={model} onChange={(e) => setModel(e.currentTarget.value)} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Provider" value={provider} onChange={(e) => setProvider(e.currentTarget.value)} /></Grid.Col>
            </Grid>
            <Select label="Reasoning effort" clearable value={reasoning} onChange={(value) => setReasoning(value ?? '')} data={['low', 'medium', 'high']} />
            <TagsInput label="Skills" description="Press Enter after each skill" value={skills} onChange={setSkills} splitChars={[',']} />
            <TagsInput label="Enabled toolsets" description="Press Enter after each toolset" value={toolsets} onChange={setToolsets} splitChars={[',']} />
            <Group>
              <Checkbox label="No agent (script only)" checked={noAgent} onChange={(e) => setNoAgent(e.currentTarget.checked)} />
              <Checkbox label="Continuity (attach to session)" checked={continuity} onChange={(e) => setContinuity(e.currentTarget.checked)} />
            </Group>
          </Stack>
        )}
        {!hasPayload && <Text c="red" size="sm">Provide at least one of name, prompt, or script.</Text>}
        {noAgent && !script.trim() && <Text c="red" size="sm">Script-only tasks require a script.</Text>}
        {conflictingMonitors && <Text c="red" size="sm">Monitor script and monitor URL are mutually exclusive.</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={!valid}>{submitLabel}</Button>
        </Group>
      </Stack>
    </form>
  );
}

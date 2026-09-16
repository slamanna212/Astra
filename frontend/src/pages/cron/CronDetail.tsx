import { Badge, Center, Code, Group, Loader, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { getCronJob, type CronScriptFieldName } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import type { CronJob } from '../../api/types';
import { deliveryLabel, humanSchedule, jobStateBadge, lastRunBadge, repeatLabel } from '../../lib/cron';
import { formatDateTime } from '../../lib/format';
import { CRON_DETAIL_GROUPS } from './cronDetailFields';
import { CronOutputs } from './CronOutputs';
import classes from './CronDetail.module.css';
import { ScriptField } from './ScriptField';

const SCRIPT_FIELDS = new Set<string>(['script', 'post_script', 'monitor_script']);

function isoOrDash(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : formatDateTime(parsed / 1000);
}

function FieldValue({ job, field }: { job: CronJob; field: string }) {
  const value = job[field];

  if (field === 'schedule') {
    return (
      <Stack gap={2}>
        <Text size="sm">{humanSchedule(job)}</Text>
        {value != null && (
          <Code block fz="xs">
            {JSON.stringify(value, null, 2)}
          </Code>
        )}
      </Stack>
    );
  }
  if (field === 'deliver') return <Text size="sm">{deliveryLabel(job.deliver)}</Text>;
  if (field === 'repeat') return <Text size="sm">{repeatLabel(job.repeat)}</Text>;
  if (field === 'next_run_at' || field === 'last_run_at' || field === 'created_at') return <Text size="sm">{isoOrDash(value)}</Text>;
  if (field === 'no_agent' || field === 'attach_to_session') {
    return (
      <Badge size="sm" variant="light" color={value ? 'blue' : 'gray'}>
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }
  if (SCRIPT_FIELDS.has(field)) {
    if (typeof value !== 'string' || !value) return <Text size="sm" c="dimmed">not set</Text>;
    return <ScriptField jobId={job.id} field={field as CronScriptFieldName} filename={value} />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Text size="sm" c="dimmed">none</Text>;
    return (
      <Group gap={4}>
        {value.map((item, i) => (
          <Badge key={i} size="sm" variant="outline">
            {String(item)}
          </Badge>
        ))}
      </Group>
    );
  }
  if (value === null || value === undefined || value === '') return <Text size="sm" c="dimmed">—</Text>;
  if (typeof value === 'object') {
    return (
      <Code block fz="xs">
        {JSON.stringify(value, null, 2)}
      </Code>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <Badge size="sm" variant="light" color={value ? 'blue' : 'gray'}>
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }
  return <Text size="sm">{String(value)}</Text>;
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      {children}
    </>
  );
}

function GroupCard({ title, job, fields }: { title: string; job: CronJob; fields: { key: string; label: string }[] }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={5} mb="sm">
        {title}
      </Title>
      <div className={classes.fieldGrid}>
        {fields.map((f) => (
          <FieldRow key={f.key} label={f.label}>
            <FieldValue job={job} field={f.key} />
          </FieldRow>
        ))}
      </div>
    </Paper>
  );
}

export default function CronDetail() {
  const { jobId } = useParams();
  const query = useQuery({
    queryKey: queryKeys.cron.detail(jobId ?? ''),
    queryFn: ({ signal }) => getCronJob(jobId ?? '', signal),
    enabled: !!jobId,
  });

  if (query.isLoading) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Center h="100%">
        <Text c="red">{query.error.message}</Text>
      </Center>
    );
  }
  const job = query.data;
  if (!job) return null;

  const state = jobStateBadge(job);
  const lastRun = lastRunBadge(job);

  return (
    <div className={classes.root}>
      <Group justify="space-between" align="flex-start" mb="md" wrap="wrap">
        <div>
          <Title order={3}>{job.name}</Title>
          <Text size="xs" c="dimmed">
            {job.id}
          </Text>
        </div>
        <Group gap="xs">
          <Badge color={state.color} variant="light">
            {state.label}
          </Badge>
          {lastRun && (
            <Badge color={lastRun.color} variant="outline">
              Last run: {lastRun.label}
            </Badge>
          )}
          {job.failure_streak > 0 && (
            <Badge color="red" variant="light">
              {job.failure_streak} failure{job.failure_streak === 1 ? '' : 's'} in a row
            </Badge>
          )}
        </Group>
      </Group>

      <Tabs defaultValue="details" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="details">Details</Tabs.Tab>
          <Tabs.Tab value="outputs">Outputs</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="details">
          <Stack gap="md">
            {CRON_DETAIL_GROUPS.map((group) => (
              <GroupCard key={group.title} title={group.title} job={job} fields={group.fields} />
            ))}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="outputs">
          <CronOutputs jobId={job.id} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

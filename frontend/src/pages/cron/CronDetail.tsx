import { Badge, Button, Center, Code, Group, Loader, Modal, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { deleteCronJob, getCronJob, pauseCronJob, resumeCronJob, runCronJob, updateCronJob, type CronScriptFieldName } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import type { CronJob } from '../../api/types';
import { deliveryLabel, humanSchedule, jobStateBadge, lastRunBadge, repeatLabel } from '../../lib/cron';
import { formatDateTime } from '../../lib/format';
import { CRON_DETAIL_GROUPS } from './cronDetailFields';
import { CronOutputs } from './CronOutputs';
import classes from './CronDetail.module.css';
import { ScriptField } from './ScriptField';
import { CronForm } from './CronForm';

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
      <Badge size="sm" variant="light" color={value ? 'teal' : 'gray'}>
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
      <Badge size="sm" variant="light" color={value ? 'teal' : 'gray'}>
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
    <Paper withBorder p="md">
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.cron.detail(jobId ?? ''),
    queryFn: ({ signal }) => getCronJob(jobId ?? '', signal),
    enabled: !!jobId,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.cron.all });
  const update = useMutation({
    mutationFn: (input: Parameters<typeof updateCronJob>[1]) => updateCronJob(jobId ?? '', input),
    onSuccess: () => { setEditing(false); refresh(); notifications.show({ color: 'green', message: 'Scheduled task saved' }); },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not save task', message: error.message }),
  });
  const run = useMutation({
    mutationFn: () => runCronJob(jobId ?? ''),
    onSuccess: () => notifications.show({ color: 'green', message: 'Run accepted' }),
    onError: (error) => notifications.show({ color: 'red', title: 'Could not run task', message: error.message }),
  });
  const toggle = useMutation({
    mutationFn: () => query.data?.enabled ? pauseCronJob(jobId ?? '', 'Paused from Astra') : resumeCronJob(jobId ?? ''),
    onSuccess: refresh,
    onError: (error) => notifications.show({ color: 'red', title: 'Could not change task state', message: error.message }),
  });
  const remove = useMutation({
    mutationFn: () => deleteCronJob(jobId ?? ''),
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Scheduled task deleted' }); void navigate('/cron'); },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not delete task', message: error.message }),
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
            <Badge color={lastRun.color} variant="light">
              Last run: {lastRun.label}
            </Badge>
          )}
          {job.failure_streak > 0 && (
            <Badge color="red" variant="light">
              {job.failure_streak} failure{job.failure_streak === 1 ? '' : 's'} in a row
            </Badge>
          )}
          <Button size="xs" variant="default" leftSection={<IconEdit size={15} />} onClick={() => setEditing(true)}>Edit</Button>
          <Button size="xs" variant="default" onClick={() => toggle.mutate()} loading={toggle.isPending}>{job.enabled ? 'Pause' : 'Resume'}</Button>
          <Button size="xs" leftSection={<IconPlayerPlay size={15} />} onClick={() => run.mutate()} loading={run.isPending}>Run now</Button>
          <Button
            size="xs"
            color="red"
            variant="subtle"
            leftSection={<IconTrash size={15} />}
            loading={remove.isPending}
            onClick={() => { if (window.confirm(`Delete “${job.name}”? This cannot be undone.`)) remove.mutate(); }}
          >Delete</Button>
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
      <Modal opened={editing} onClose={() => setEditing(false)} title={`Edit ${job.name}`} size="xl">
        <CronForm key={job.id} job={job} submitLabel="Save changes" pending={update.isPending} onSubmit={(input) => update.mutate(input)} onCancel={() => setEditing(false)} />
      </Modal>
    </div>
  );
}

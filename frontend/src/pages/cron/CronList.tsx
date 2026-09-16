import { ActionIcon, Badge, Center, Group, Loader, Modal, Stack, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createCronJob, listCronJobs } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import type { CronJob } from '../../api/types';
import { useNow } from '../../hooks/useNow';
import { deliveryLabel, humanSchedule, jobStateBadge, lastRunBadge } from '../../lib/cron';
import { formatRelativeTime } from '../../lib/format';
import classes from './CronList.module.css';
import { CronForm } from './CronForm';

function CronRow({ job, active, now }: { job: CronJob; active: boolean; now: number }) {
  const state = jobStateBadge(job);
  const lastRun = lastRunBadge(job);
  const nextRun = job.next_run_at ? Date.parse(job.next_run_at) / 1000 : null;
  return (
    <Link to={`/cron/${encodeURIComponent(job.id)}`} className={classes.row} data-active={active || undefined}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} truncate="end">
          {job.name}
        </Text>
        <Badge color={state.color} size="sm" variant="light">
          {state.label}
        </Badge>
      </Group>
      <Text component="span" ff="monospace" fz={11} c="dimmed" truncate="end">
        {humanSchedule(job)} · {deliveryLabel(job.deliver)}
      </Text>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text component="span" ff="monospace" fz={11} c="dimmed">
          {nextRun ? `Next ${formatRelativeTime(nextRun, now)}` : 'No next run'}
        </Text>
        {lastRun && (
          <Badge color={lastRun.color} size="xs" variant="light">
            {lastRun.label}
          </Badge>
        )}
      </Group>
    </Link>
  );
}

export function CronList({ selectedId }: { selectedId: string | undefined }) {
  const now = useNow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.cron.list(),
    queryFn: ({ signal }) => listCronJobs(signal),
  });
  const create = useMutation({
    mutationFn: createCronJob,
    onSuccess: (job) => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cron.all });
      notifications.show({ color: 'green', message: `Created ${job.name}` });
      void navigate(`/cron/${encodeURIComponent(job.id)}`);
    },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not create task', message: error.message }),
  });

  return (
    <Stack gap={0} h="100%">
      <Group
        justify="space-between"
        px="md"
        py="sm"
        style={{ borderBottom: '1px solid var(--astra-border)', background: 'var(--astra-bg-chrome)' }}
      >
        <Title order={3}>Scheduled tasks</Title>
        <Group gap="xs">
          {query.data && (
            <Text ff="monospace" fz={11} c="dimmed">
              {query.data.items.length}
            </Text>
          )}
          <Tooltip label="Create scheduled task">
            <ActionIcon aria-label="Create scheduled task" onClick={() => setCreating(true)}><IconPlus size={16} /></ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div className={classes.scroller}>
        {query.isLoading && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}
        {query.isError && (
          <Text c="red" size="sm" p="md">
            {query.error.message}
          </Text>
        )}
        {query.data?.items.map((job) => (
          <CronRow key={job.id} job={job} active={job.id === selectedId} now={now} />
        ))}
        {query.data && query.data.items.length === 0 && (
          <Text c="dimmed" size="sm" p="md">
            No scheduled tasks.
          </Text>
        )}
      </div>
      <Modal opened={creating} onClose={() => setCreating(false)} title="Create scheduled task" size="xl">
        <CronForm submitLabel="Create task" pending={create.isPending} onSubmit={(input) => create.mutate(input)} onCancel={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}

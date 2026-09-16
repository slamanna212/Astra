import { Badge, Center, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { listCronJobs } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import type { CronJob } from '../../api/types';
import { useNow } from '../../hooks/useNow';
import { deliveryLabel, humanSchedule, jobStateBadge, lastRunBadge } from '../../lib/cron';
import { formatRelativeTime } from '../../lib/format';
import classes from './CronList.module.css';

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
      <Text size="xs" c="dimmed" truncate="end">
        {humanSchedule(job)} · {deliveryLabel(job.deliver)}
      </Text>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed">
          {nextRun ? `Next ${formatRelativeTime(nextRun, now)}` : 'No next run'}
        </Text>
        {lastRun && (
          <Badge color={lastRun.color} size="xs" variant="outline">
            {lastRun.label}
          </Badge>
        )}
      </Group>
    </Link>
  );
}

export function CronList({ selectedId }: { selectedId: string | undefined }) {
  const now = useNow();
  const query = useQuery({
    queryKey: queryKeys.cron.list(),
    queryFn: ({ signal }) => listCronJobs(signal),
  });

  return (
    <Stack gap={0} h="100%">
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Title order={4}>Scheduled tasks</Title>
        {query.data && (
          <Text size="xs" c="dimmed">
            {query.data.items.length}
          </Text>
        )}
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
    </Stack>
  );
}

import { ActionIcon, Badge, Center, Group, Loader, Modal, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createCronJob, listCronJobs } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import type { CronJob } from '../../api/types';
import { useNow } from '../../hooks/useNow';
import { deliveryLabel, humanSchedule, jobStateBadge } from '../../lib/cron';
import { formatRelativeTime } from '../../lib/format';
import classes from './CronList.module.css';
import { CronForm } from './CronForm';

/** The row's own badge stays quiet for the common healthy case (matches the mock: only a
    paused/error/failing job earns a badge) — repeating "Scheduled" on every row is noise
    the detail header already carries. */
function CronRowBadge({ job }: { job: CronJob }) {
  if (job.failure_streak > 0) {
    return (
      <Badge color="red" size="sm" variant="light">
        {job.failure_streak} failure{job.failure_streak === 1 ? '' : 's'}
      </Badge>
    );
  }
  const state = jobStateBadge(job);
  if (state.label === 'Scheduled') return null;
  return (
    <Badge color={state.color} size="sm" variant="light">
      {state.label}
    </Badge>
  );
}

function CronRow({ job, active, now }: { job: CronJob; active: boolean; now: number }) {
  const nextRun = job.next_run_at ? Date.parse(job.next_run_at) / 1000 : null;
  return (
    <Link to={`/cron/${encodeURIComponent(job.id)}`} className={classes.row} data-active={active || undefined}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} truncate="end">
          {job.name}
        </Text>
        <CronRowBadge job={job} />
      </Group>
      <Text component="span" fz={11} c="dimmed" truncate="end">
        {nextRun ? `Next ${formatRelativeTime(nextRun, now)}` : 'No next run'} · {humanSchedule(job)} · {deliveryLabel(job.deliver)}
      </Text>
    </Link>
  );
}

export function CronList({ selectedId }: { selectedId: string | undefined }) {
  const now = useNow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
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

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((job) => job.name.toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <Stack gap={0} h="100%">
      <Stack gap="xs" px="md" py="sm" style={{ borderBottom: '1px solid var(--astra-border)', background: 'var(--astra-bg-chrome)' }}>
        <Group justify="space-between">
          <Title order={3}>Scheduled tasks</Title>
          <Group gap="xs">
            {query.data && (
              <Text fz={11} c="dimmed">
                {query.data.items.length} task{query.data.items.length === 1 ? '' : 's'}
              </Text>
            )}
            <Tooltip label="Create scheduled task">
              <ActionIcon aria-label="Create scheduled task" onClick={() => setCreating(true)}><IconPlus size={16} /></ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <TextInput
          placeholder="Search tasks…"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Stack>
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
        {filtered.map((job) => (
          <CronRow key={job.id} job={job} active={job.id === selectedId} now={now} />
        ))}
        {query.data && filtered.length === 0 && (
          <Text c="dimmed" size="sm" p="md">
            {search ? 'No matching tasks.' : 'No scheduled tasks.'}
          </Text>
        )}
      </div>
      <Modal opened={creating} onClose={() => setCreating(false)} title="Create scheduled task" size="xl">
        <CronForm submitLabel="Create task" pending={create.isPending} onSubmit={(input) => create.mutate(input)} onCancel={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}

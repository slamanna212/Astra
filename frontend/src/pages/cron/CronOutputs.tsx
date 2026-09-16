import { Badge, Button, Center, Group, Loader, Paper, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getCronJobOutput, listCronJobOutput } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import { Markdown } from '../../components/Markdown';
import { formatBytes, formatDateTime } from '../../lib/format';

function statusForRun(runTimestamp: string, executions: { claimed_at: string | null; status: string }[]): string | null {
  // Runs and executions.db rows aren't joined by id — correlate loosely by nearest claimed_at
  // within a few seconds of the run's filename timestamp (`YYYY-MM-DD_HH-MM-SS`).
  const runMs = Date.parse(runTimestamp.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4'));
  if (Number.isNaN(runMs)) return null;
  let best: { status: string; diff: number } | null = null;
  for (const ex of executions) {
    if (!ex.claimed_at) continue;
    const diff = Math.abs(Date.parse(ex.claimed_at) - runMs);
    if (diff < 15_000 && (!best || diff < best.diff)) best = { status: ex.status, diff };
  }
  return best?.status ?? null;
}

export function CronOutputs({ jobId }: { jobId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const listQuery = useQuery({
    queryKey: queryKeys.cron.output(jobId, null),
    queryFn: ({ signal }) => listCronJobOutput(jobId, { limit: 100 }, signal),
  });
  const contentQuery = useQuery({
    queryKey: queryKeys.cron.outputContent(jobId, selected ?? ''),
    queryFn: ({ signal }) => getCronJobOutput(jobId, selected ?? '', signal),
    enabled: !!selected,
  });

  if (listQuery.isLoading) {
    return (
      <Center py="lg">
        <Loader size="sm" />
      </Center>
    );
  }
  if (listQuery.isError) {
    return <Text c="red">{listQuery.error.message}</Text>;
  }
  const runs = listQuery.data?.items ?? [];
  const executions = listQuery.data?.executions ?? [];

  if (runs.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No runs yet.
      </Text>
    );
  }

  return (
    <Group align="flex-start" wrap="wrap" gap="md">
      <Paper withBorder style={{ width: '20rem', flexShrink: 0 }}>
        <ScrollArea.Autosize mah={480}>
          <Table highlightOnHover>
            <Table.Tbody>
              {runs.map((run) => {
                const status = run.timestamp ? statusForRun(run.timestamp, executions) : null;
                return (
                  <Table.Tr
                    key={run.filename}
                    onClick={() => setSelected(run.filename)}
                    style={{ cursor: 'pointer' }}
                    data-selected={run.filename === selected || undefined}
                    bg={run.filename === selected ? 'var(--astra-selected)' : undefined}
                  >
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">{run.timestamp ? formatDateTime(Date.parse(run.timestamp.replace(
                          /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/,
                          '$1T$2:$3:$4',
                        )) / 1000) : run.filename}</Text>
                        <Group gap={4}>
                          <Text size="xs" c="dimmed">
                            {formatBytes(run.size_bytes)}
                          </Text>
                          {status && (
                            <Badge size="xs" variant="light" color={status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'gray'}>
                              {status}
                            </Badge>
                          )}
                        </Group>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Paper>
      <Paper withBorder p="md" style={{ flex: 1, minWidth: '20rem' }}>
        {!selected && (
          <Text c="dimmed" size="sm">
            Select a run to view its output.
          </Text>
        )}
        {selected && contentQuery.isLoading && <Loader size="sm" />}
        {selected && contentQuery.isError && <Text c="red">{contentQuery.error.message}</Text>}
        {selected && contentQuery.data && (
          <Stack gap="sm">
            {contentQuery.data.truncated && (
              <Button size="compact-xs" variant="light" color="sand" disabled>
                Output truncated
              </Button>
            )}
            <Markdown>{contentQuery.data.content}</Markdown>
          </Stack>
        )}
      </Paper>
    </Group>
  );
}

import { BarChart, DonutChart } from '@mantine/charts';
import {
  Alert,
  Card,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { browserTimeZone, getInsights } from '../../api/insights';
import { queryKeys } from '../../api/queryKeys';
import type { InsightsRange, InsightsResponse } from '../../api/types';
import { SourceBadge } from '../../components/SourceBadge';
import {
  formatCost,
  formatCount,
  formatDateTime,
  formatPercent,
  formatShortDate,
  formatTokens,
  sessionTitle,
} from '../../lib/format';

const RANGE_OPTIONS: { value: InsightsRange; label: string }[] = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
  { value: 'all', label: 'All' },
];

const TOKEN_KIND_SERIES = [
  { name: 'input_tokens', label: 'Input', color: 'blue.6' },
  { name: 'output_tokens', label: 'Output', color: 'teal.6' },
  { name: 'cache_read_tokens', label: 'Cache read', color: 'grape.6' },
  { name: 'cache_write_tokens', label: 'Cache write', color: 'orange.6' },
  { name: 'reasoning_tokens', label: 'Reasoning', color: 'yellow.6' },
];

const PALETTE = ['blue.6', 'teal.6', 'grape.6', 'orange.6', 'yellow.6', 'pink.6', 'cyan.6', 'lime.6', 'red.6', 'indigo.6'];

function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length] ?? 'gray.6';
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Paper>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card withBorder p="md">
      <Title order={3} mb="sm">
        {title}
      </Title>
      {children}
    </Card>
  );
}

export default function InsightsPage() {
  const [range, setRange] = useState<InsightsRange>('30');
  const tz = useMemo(() => browserTimeZone(), []);

  const query = useQuery({
    queryKey: queryKeys.insights.report(range, tz),
    queryFn: ({ signal }) => getInsights(range, tz, signal),
    placeholderData: (prev) => prev,
  });

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={1}>Insights</Title>
        <SegmentedControl
          value={range}
          onChange={(v) => setRange(v as InsightsRange)}
          data={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Group>

      {query.isPending && (
        <Center p="xl">
          <Loader size="sm" />
        </Center>
      )}

      {query.isError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Failed to load insights">
          {query.error.message}
        </Alert>
      )}

      {query.data && query.data.totals.sessions === 0 && (
        <Center p="xl">
          <Text c="dimmed" fz={14}>
            No sessions in this range.
          </Text>
        </Center>
      )}

      {query.data && query.data.totals.sessions > 0 && <InsightsBody data={query.data} />}
    </Stack>
  );
}

function InsightsBody({ data }: { data: InsightsResponse }) {
  const { totals, daily, models, providers, sources, auxiliary, top_sessions: topSessions } = data;

  const dailyChartData = daily.map((d) => ({ ...d, label: formatShortDate(d.date) }));
  const modelChartData = models.slice(0, 8).map((m) => ({
    model: m.model,
    estimated_cost_usd: m.estimated_cost_usd,
  }));
  const providerDonutData = providers.map((p, i) => ({
    name: p.provider,
    value: p.estimated_cost_usd,
    color: paletteColor(i),
  }));

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="md">
        <StatCard label="Total tokens" value={formatTokens(totals.total_tokens)} />
        <StatCard
          label="Est. cost"
          value={formatCost(totals.estimated_cost_usd)}
          sub={totals.auxiliary_estimated_cost_usd > 0 ? `${formatCost(totals.auxiliary_estimated_cost_usd)} auxiliary` : undefined}
        />
        <StatCard label="Sessions" value={formatCount(totals.sessions)} />
        <StatCard label="Cache hit rate" value={formatPercent(totals.cache_hit_rate)} />
        <StatCard label="Tool calls" value={formatCount(totals.tool_calls)} />
        <StatCard label="API calls" value={formatCount(totals.api_calls)} />
      </SimpleGrid>

      <SectionCard title="Daily tokens">
        <BarChart
          h={260}
          data={dailyChartData}
          dataKey="label"
          type="stacked"
          series={TOKEN_KIND_SERIES}
          withLegend
          valueFormatter={(v) => formatTokens(v)}
        />
      </SectionCard>

      <SectionCard title="Daily cost">
        <BarChart
          h={220}
          data={dailyChartData}
          dataKey="label"
          series={[{ name: 'estimated_cost_usd', label: 'Est. cost', color: 'teal.6' }]}
          valueFormatter={(v) => formatCost(v)}
        />
      </SectionCard>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <SectionCard title="By model">
          <Stack gap="md">
            <BarChart
              h={Math.max(120, modelChartData.length * 36)}
              data={modelChartData}
              dataKey="model"
              orientation="vertical"
              series={[{ name: 'estimated_cost_usd', label: 'Est. cost', color: 'teal.6' }]}
              valueFormatter={(v) => formatCost(v)}
              withLegend={false}
              yAxisProps={{ width: 110, tickFormatter: (v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v) }}
            />
            <ScrollArea.Autosize mah={260}>
              <Table.ScrollContainer minWidth={420}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Sessions</Table.Th>
                      <Table.Th>Tokens</Table.Th>
                      <Table.Th>Cost</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {models.map((m) => (
                      <Table.Tr key={m.model}>
                        <Table.Td>{m.model}</Table.Td>
                        <Table.Td>{formatCount(m.sessions)}</Table.Td>
                        <Table.Td>
                          {formatTokens(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens)}
                        </Table.Td>
                        <Table.Td>{formatCost(m.estimated_cost_usd)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </ScrollArea.Autosize>
          </Stack>
        </SectionCard>

        <SectionCard title="By provider">
          <Stack gap="md">
            {providerDonutData.some((p) => p.value > 0) ? (
              <Center>
                <DonutChart data={providerDonutData} withLabelsLine withLabels valueFormatter={(v) => formatCost(v)} />
              </Center>
            ) : (
              <Text c="dimmed" size="sm">
                No cost data for this range.
              </Text>
            )}
            <Table.ScrollContainer minWidth={420}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Provider</Table.Th>
                    <Table.Th>Sessions</Table.Th>
                    <Table.Th>Tokens</Table.Th>
                    <Table.Th>Cost</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {providers.map((p) => (
                    <Table.Tr key={p.provider}>
                      <Table.Td>{p.provider}</Table.Td>
                      <Table.Td>{formatCount(p.sessions)}</Table.Td>
                      <Table.Td>
                        {formatTokens(p.input_tokens + p.output_tokens + p.cache_read_tokens + p.cache_write_tokens)}
                      </Table.Td>
                      <Table.Td>{formatCost(p.estimated_cost_usd)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </SectionCard>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <SectionCard title="Auxiliary task spend">
          {auxiliary.length === 0 ? (
            <Text c="dimmed" size="sm">
              No auxiliary (title generation, compression, background review, ...) usage in this range.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={380}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Task</Table.Th>
                    <Table.Th>Sessions</Table.Th>
                    <Table.Th>Tokens</Table.Th>
                    <Table.Th>Cost</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {auxiliary.map((a) => (
                    <Table.Tr key={a.task}>
                      <Table.Td>{a.task}</Table.Td>
                      <Table.Td>{formatCount(a.sessions)}</Table.Td>
                      <Table.Td>{formatTokens(a.input_tokens + a.output_tokens)}</Table.Td>
                      <Table.Td>{formatCost(a.estimated_cost_usd)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </SectionCard>

        <SectionCard title="By source">
          <Table.ScrollContainer minWidth={460}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Sessions</Table.Th>
                  <Table.Th>Messages</Table.Th>
                  <Table.Th>Tokens</Table.Th>
                  <Table.Th>Cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sources.map((s) => (
                  <Table.Tr key={s.source}>
                    <Table.Td>
                      <SourceBadge source={s.source} />
                    </Table.Td>
                    <Table.Td>{formatCount(s.sessions)}</Table.Td>
                    <Table.Td>{formatCount(s.messages)}</Table.Td>
                    <Table.Td>{formatTokens(s.input_tokens + s.output_tokens)}</Table.Td>
                    <Table.Td>{formatCost(s.estimated_cost_usd)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </SectionCard>
      </SimpleGrid>

      <SectionCard title="Top sessions by cost">
        <ScrollArea.Autosize mah={400}>
          <Table.ScrollContainer minWidth={560}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Session</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Tokens</Table.Th>
                  <Table.Th>Cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topSessions.map((s) => (
                  <Table.Tr key={s.id}>
                    <Table.Td>
                      <Link to={`/chats/${encodeURIComponent(s.id)}`}>{sessionTitle(s)}</Link>
                    </Table.Td>
                    <Table.Td>{s.source && <SourceBadge source={s.source} />}</Table.Td>
                    <Table.Td>{s.model ?? '—'}</Table.Td>
                    <Table.Td>{formatDateTime(s.started_at)}</Table.Td>
                    <Table.Td>{formatTokens(s.input_tokens + s.output_tokens)}</Table.Td>
                    <Table.Td>{formatCost(s.estimated_cost_usd)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </ScrollArea.Autosize>
      </SectionCard>
    </Stack>
  );
}

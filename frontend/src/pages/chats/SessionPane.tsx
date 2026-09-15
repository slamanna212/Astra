import {
  Anchor,
  Button,
  Center,
  Code,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconPinFilled } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { getSession } from '../../api/sessions';
import { SourceBadge } from '../../components/SourceBadge';
import { formatCost, formatCount, formatDateTime, formatTokens, sessionTitle } from '../../lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </div>
  );
}

export default function SessionPane() {
  const { sessionId = '' } = useParams();
  const query = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: ({ signal }) => getSession(sessionId, signal),
    enabled: sessionId !== '',
  });

  const back = (
    <Button component={Link} to="/chats" variant="subtle" size="xs" leftSection={<IconArrowLeft size={14} />} hiddenFrom="sm">
      All chats
    </Button>
  );

  if (query.isPending) {
    return (
      <Stack p="md">
        {back}
        <Center p="xl">
          <Loader size="sm" />
        </Center>
      </Stack>
    );
  }

  if (query.isError) {
    return (
      <Stack p="md" align="flex-start">
        {back}
        <Text c={isApiError(query.error, 404) ? 'dimmed' : 'red'}>
          {isApiError(query.error, 404) ? 'Session not found.' : `Failed to load session: ${query.error.message}`}
        </Text>
      </Stack>
    );
  }

  const s = query.data;
  return (
    <Stack p="md" gap="md">
      {back}
      <Stack gap={6}>
        <Group gap="xs" wrap="nowrap">
          {s.pinned && <IconPinFilled size={18} aria-label="Pinned" color="var(--mantine-color-yellow-6)" />}
          <Title order={3} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {sessionTitle(s)}
          </Title>
        </Group>
        <Group gap="xs">
          <SourceBadge source={s.source} size="sm" />
          {s.model && (
            <Text size="sm" c="dimmed">
              {s.model}
            </Text>
          )}
          {s.archived && (
            <Text size="sm" c="dimmed">
              · archived
            </Text>
          )}
          {s.hidden && (
            <Text size="sm" c="dimmed">
              · hidden
            </Text>
          )}
        </Group>
        {s.last_activity_description && (
          <Text size="sm" c="dimmed">
            {s.last_activity_description}
          </Text>
        )}
      </Stack>

      <Paper withBorder p="md" radius="md">
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
          <Stat label="Started" value={formatDateTime(s.started_at)} />
          <Stat label="Last activity" value={formatDateTime(s.last_activity_at)} />
          <Stat label="Messages" value={formatCount(s.message_count)} />
          <Stat label="Tool calls" value={formatCount(s.tool_call_count)} />
          <Stat label="Input tokens" value={formatTokens(s.input_tokens)} />
          <Stat label="Output tokens" value={formatTokens(s.output_tokens)} />
          <Stat label="Est. cost" value={formatCost(s.estimated_cost_usd)} />
          <Stat label="Ended" value={formatDateTime(s.ended_at)} />
        </SimpleGrid>
      </Paper>

      <Group gap="xs">
        <Text size="xs" c="dimmed">
          ID
        </Text>
        <Code>{s.id}</Code>
        {s.parent_session_id && (
          <Text size="xs" c="dimmed">
            Parent:{' '}
            <Anchor component={Link} to={`/chats/${encodeURIComponent(s.parent_session_id)}`} size="xs">
              {s.parent_session_id}
            </Anchor>
          </Text>
        )}
      </Group>

      <Paper withBorder p="xl" radius="md">
        <Text c="dimmed" ta="center">
          Transcript coming in Phase 1.
        </Text>
      </Paper>
    </Stack>
  );
}

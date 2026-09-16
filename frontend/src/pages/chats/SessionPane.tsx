import { Alert, Anchor, Box, Button, Center, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconPinFilled } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { answerChat, chatStreamUrl, sendChat, steerChat, stopChat, type ChatStreamEvent } from '../../api/chat';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { getSession } from '../../api/sessions';
import { SourceBadge } from '../../components/SourceBadge';
import { formatCost, formatCount, formatTokens, sessionTitle } from '../../lib/format';
import { Transcript } from './transcript/Transcript';
import { ChatComposer } from './ChatComposer';

export default function SessionPane() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [clarify, setClarify] = useState<{ id: number; question: string; choices: unknown[] | null } | null>(null);
  const raf = useRef<number | null>(null);
  const pendingText = useRef('');
  const pendingReasoning = useRef('');
  const highlightParam = searchParams.get('m');
  const highlightMessageId = highlightParam && /^\d+$/.test(highlightParam) ? Number(highlightParam) : undefined;

  const query = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: ({ signal }) => getSession(sessionId, signal),
    enabled: sessionId !== '',
  });

  useEffect(() => {
    if (!running) return;
    const source = new EventSource(chatStreamUrl(sessionId));
    const flush = () => {
      raf.current = null;
      if (pendingText.current) {
        const next = pendingText.current;
        pendingText.current = '';
        setStreaming((value) => value + next);
      }
      if (pendingReasoning.current) {
        const next = pendingReasoning.current;
        pendingReasoning.current = '';
        setReasoning((value) => value + next);
      }
    };
    const schedule = () => {
      if (raf.current === null) raf.current = requestAnimationFrame(flush);
    };
    const terminal = () => {
      flush();
      setRunning(false);
      setClarify(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages.all(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      source.close();
    };
    source.addEventListener('delta', (event) => { pendingText.current += (JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string }).text; schedule(); });
    source.addEventListener('reasoning', (event) => { pendingReasoning.current += (JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string }).text; schedule(); });
    source.addEventListener('clarify', (event) => setClarify(JSON.parse((event as MessageEvent).data) as { id: number; question: string; choices: unknown[] | null }));
    source.addEventListener('done', terminal);
    source.addEventListener('cancel', terminal);
    source.addEventListener('error', terminal);
    return () => { source.close(); if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [running, sessionId, queryClient]);

  const start = async (text: string) => {
    await sendChat(sessionId, { message: text });
    setStreaming('');
    setReasoning('');
    setRunning(true);
  };

  const back = (
    <Button
      component={Link}
      to="/chats"
      variant="subtle"
      size="xs"
      leftSection={<IconArrowLeft size={14} />}
      hiddenFrom="sm"
    >
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
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack gap={6} p="md" pb="sm" style={{ flexShrink: 0, borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        {back}
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {s.pinned && <IconPinFilled size={16} aria-label="Pinned" color="var(--mantine-color-yellow-6)" style={{ marginTop: 4 }} />}
          <Title order={4} style={{ minWidth: 0, overflowWrap: 'anywhere', flex: 1 }}>
            {sessionTitle(s)}
          </Title>
        </Group>
        <Group gap="sm" wrap="wrap">
          <SourceBadge source={s.source} size="sm" />
          {s.model && (
            <Text size="sm" c="dimmed">
              {s.model}
            </Text>
          )}
          <Tooltip label={`${formatTokens(s.input_tokens)} in · ${formatTokens(s.output_tokens)} out`}>
            <Text size="sm" c="dimmed">
              {formatCount(s.message_count)} msgs · {formatCost(s.estimated_cost_usd)}
            </Text>
          </Tooltip>
          {s.archived && (
            <Text size="sm" c="dimmed">
              archived
            </Text>
          )}
          {s.hidden && (
            <Text size="sm" c="dimmed">
              hidden
            </Text>
          )}
          {s.parent_session_id && (
            <Text size="xs" c="dimmed">
              Parent:{' '}
              <Anchor component={Link} to={`/chats/${encodeURIComponent(s.parent_session_id)}`} size="xs">
                {s.parent_session_id}
              </Anchor>
            </Text>
          )}
        </Group>
      </Stack>

      <Box style={{ flex: 1, minHeight: 0 }}>
        <Transcript sessionId={sessionId} highlightMessageId={highlightMessageId} />
      </Box>
      {reasoning && <Alert m="sm" color="gray" title="Thinking">{reasoning}</Alert>}
      {streaming && <Text p="sm" style={{ whiteSpace: 'pre-wrap' }}>{streaming}</Text>}
      {clarify && (
        <Alert m="sm" title={clarify.question}>
          <Group mt="xs">
            {(clarify.choices ?? []).map((choice) => (
              <Button key={String(choice)} size="xs" onClick={() => void answerChat(sessionId, clarify.id, String(choice))}>{String(choice)}</Button>
            ))}
          </Group>
        </Alert>
      )}
      <ChatComposer
        running={running}
        onSend={start}
        onStop={() => stopChat(sessionId)}
        onSteer={(text) => steerChat(sessionId, text)}
      />
    </Box>
  );
}

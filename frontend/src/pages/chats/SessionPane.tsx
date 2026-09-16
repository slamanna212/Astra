import { Alert, Anchor, Badge, Box, Button, Center, Code, Group, Loader, Paper, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { answerChat, approveChat, chatStreamUrl, getChatOptions, sendChat, steerChat, stopChat, type ChatStreamEvent } from '../../api/chat';
import { uploadFile } from '../../api/files';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { deleteSession, getSession, updateSession } from '../../api/sessions';
import { SourceBadge } from '../../components/SourceBadge';
import { formatCost, formatCount, formatTokens, sessionTitle } from '../../lib/format';
import { Transcript } from './transcript/Transcript';
import { ChatComposer } from './ChatComposer';

export default function SessionPane() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [clarify, setClarify] = useState<{ id: number; question: string; choices: unknown[] | null } | null>(null);
  const [clarifyText, setClarifyText] = useState('');
  const [approval, setApproval] = useState<{ request_id: string; command?: string; description?: string } | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [activity, setActivity] = useState<string[]>([]);
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
  const options = useQuery({
    queryKey: ['chat-options', sessionId],
    queryFn: ({ signal }) => getChatOptions(sessionId, signal),
    enabled: sessionId !== '',
  });
  const patchSession = useMutation({
    mutationFn: (body: Parameters<typeof updateSession>[1]) => updateSession(sessionId, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.sessions.detail(sessionId), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
    },
  });
  const removeSession = useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      navigate('/chats', { replace: true });
    },
  });

  const selectedModel = model === undefined ? (options.data?.default_model ?? null) : model;
  const selectedProvider = provider === undefined ? (options.data?.default_provider ?? null) : provider;

  useEffect(() => {
    const source = new EventSource(chatStreamUrl(sessionId));
    source.onopen = () => setConnection('live');
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
      setApproval(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages.all(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    };
    source.addEventListener('state', (event) => {
      const state = JSON.parse((event as MessageEvent).data) as { running: boolean };
      setRunning(state.running);
      // If completion happened while this browser was disconnected, the terminal SSE frame is
      // no longer replayable after the turn is evicted. Canonical history closes that gap.
      if (!state.running) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages.all(sessionId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      }
    });
    source.addEventListener('started', () => { setRunning(true); setStreaming(''); setReasoning(''); setActivity([]); });
    source.addEventListener('delta', (event) => { pendingText.current += (JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string }).text; schedule(); });
    source.addEventListener('reasoning', (event) => { pendingReasoning.current += (JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string }).text; schedule(); });
    source.addEventListener('clarify', (event) => setClarify(JSON.parse((event as MessageEvent).data) as { id: number; question: string; choices: unknown[] | null }));
    source.addEventListener('approval', (event) => setApproval(JSON.parse((event as MessageEvent).data) as { request_id: string; command?: string; description?: string }));
    source.addEventListener('approval_resolved', () => setApproval(null));
    source.addEventListener('tool', (event) => setActivity((items) => [...items.slice(-4), `Tool: ${(event as MessageEvent).data}`]));
    source.addEventListener('subagent', (event) => setActivity((items) => [...items.slice(-4), `Subagent: ${(event as MessageEvent).data}`]));
    const finish = (event: Event) => {
      if (event instanceof MessageEvent && event.data) {
        const payload = JSON.parse(event.data) as { late_steer?: string | null };
        if (payload.late_steer) setDraft((value) => value || payload.late_steer || '');
      }
      terminal();
    };
    source.addEventListener('done', finish);
    source.addEventListener('cancel', finish);
    source.addEventListener('error', (event) => {
      if (event instanceof MessageEvent && event.data) finish(event);
      else {
        setConnection('reconnecting');
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages.all(sessionId) });
      }
    });
    return () => { source.close(); if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [sessionId, queryClient]);

  const start = async (text: string) => {
    await sendChat(sessionId, { message: text, model: selectedModel, provider: selectedProvider });
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
      <Stack
        gap={6}
        p="md"
        pb="sm"
        style={{ flexShrink: 0, borderBottom: '1px solid var(--astra-border)', background: 'var(--astra-bg-chrome)' }}
      >
        {back}
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {s.pinned && (
            <Text component="span" c="sand" fz={14} style={{ marginTop: 2 }} aria-label="Pinned">
              ★
            </Text>
          )}
          <Text fz={14} fw={600} style={{ minWidth: 0, overflowWrap: 'anywhere', flex: 1 }}>
            {sessionTitle(s)}
          </Text>
          <Group gap={4} wrap="wrap" justify="flex-end">
            <Button size="compact-xs" variant="subtle" onClick={() => {
              const title = window.prompt('Conversation title', s.title ?? '');
              if (title !== null) patchSession.mutate({ title });
            }}>Rename</Button>
            <Button size="compact-xs" variant="subtle" onClick={() => patchSession.mutate({ pinned: !s.pinned })}>{s.pinned ? 'Unpin' : 'Pin'}</Button>
            <Button size="compact-xs" variant="subtle" onClick={() => patchSession.mutate({ archived: !s.archived })}>{s.archived ? 'Unarchive' : 'Archive'}</Button>
            <Button size="compact-xs" variant="subtle" onClick={() => patchSession.mutate({ hidden: !s.hidden })}>{s.hidden ? 'Unhide' : 'Hide'}</Button>
            <Button size="compact-xs" color="red" variant="subtle" disabled={running} loading={removeSession.isPending} onClick={() => {
              if (window.confirm('Delete this conversation and its messages? This cannot be undone.')) removeSession.mutate();
            }}>Delete</Button>
          </Group>
        </Group>
        <Group gap="sm" wrap="wrap">
          <SourceBadge source={s.source} size="sm" />
          <Badge size="sm" color={connection === 'live' ? 'green' : 'sand'} variant="light">{connection}</Badge>
          {s.model && (
            <Text ff="monospace" fz={11} c="dimmed">
              {s.model}
            </Text>
          )}
          <Tooltip label={`${formatTokens(s.input_tokens)} in · ${formatTokens(s.output_tokens)} out`}>
            <Text ff="monospace" fz={11} c="dimmed">
              {formatCount(s.message_count)} msgs · {formatCost(s.estimated_cost_usd)}
            </Text>
          </Tooltip>
          {s.archived && (
            <Badge size="sm" variant="outline" color="gray">
              archived
            </Badge>
          )}
          {s.hidden && (
            <Badge size="sm" variant="outline" color="gray">
              hidden
            </Badge>
          )}
          {s.parent_session_id && (
            <Text fz={11} c="dimmed">
              Parent:{' '}
              <Anchor component={Link} to={`/chats/${encodeURIComponent(s.parent_session_id)}`} ff="monospace" fz={11}>
                {s.parent_session_id}
              </Anchor>
            </Text>
          )}
        </Group>
      </Stack>

      <Box style={{ flex: 1, minHeight: 0 }}>
        <Transcript sessionId={sessionId} highlightMessageId={highlightMessageId} />
      </Box>
      <Box style={{ maxWidth: 'var(--astra-chat-content-w)', width: '100%', margin: '0 auto' }}>
        {reasoning && <Alert m="sm" color="gray" title="Thinking">{reasoning}</Alert>}
        {streaming && <Text p="sm" style={{ whiteSpace: 'pre-wrap' }}>{streaming}</Text>}
        {clarify && (
          <Alert m="sm" title={clarify.question}>
            <Group mt="xs">
              {(clarify.choices ?? []).map((choice) => (
                <Button key={String(choice)} size="xs" onClick={() => void answerChat(sessionId, clarify.id, String(choice))}>{String(choice)}</Button>
              ))}
              <TextInput value={clarifyText} onChange={(event) => setClarifyText(event.currentTarget.value)} placeholder="Type another answer" style={{ flex: 1 }} />
              <Button size="xs" disabled={!clarifyText.trim()} onClick={() => { void answerChat(sessionId, clarify.id, clarifyText.trim()); setClarifyText(''); }}>Answer</Button>
            </Group>
          </Alert>
        )}
        {approval && (
          <Alert m="sm" color="sand" title="Approval required">
            <Text size="sm">{approval.description ?? 'Hermes needs permission to continue.'}</Text>
            {approval.command && <Code block mt="xs">{approval.command}</Code>}
            <Group mt="xs">
              {(['once', 'session', 'always', 'deny'] as const).map((choice) => (
                <Button key={choice} size="xs" color={choice === 'deny' ? 'red' : undefined} variant={choice === 'deny' ? 'light' : 'filled'} onClick={() => void approveChat(sessionId, approval.request_id, choice)}>
                  {choice === 'once' ? 'Approve once' : choice === 'session' ? 'Approve session' : choice === 'always' ? 'Always approve' : 'Deny'}
                </Button>
              ))}
            </Group>
          </Alert>
        )}
        {activity.length > 0 && <Paper mx="sm" p="xs" withBorder>{activity.map((item, index) => <Text size="xs" c="dimmed" key={`${index}-${item}`}>{item}</Text>)}</Paper>}
      </Box>
      <ChatComposer
        running={running}
        onSend={start}
        onStop={() => stopChat(sessionId)}
        onSteer={(text) => steerChat(sessionId, text)}
        model={selectedModel}
        provider={selectedProvider}
        models={options.data?.models ?? (s.model ? [s.model] : [])}
        providers={options.data?.providers ?? []}
        onModelChange={setModel}
        onProviderChange={setProvider}
        draft={draft}
        onDraftChange={setDraft}
        onAttach={async (file) => (await uploadFile({ directory: '', file })).path}
      />
    </Box>
  );
}

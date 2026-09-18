import { Alert, Anchor, Badge, Box, Button, Center, Code, Group, Loader, Menu, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconChevronDown, IconDownload, IconFileCode, IconFileText, IconGitBranch, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { answerChat, approveChat, chatStreamUrl, compactChat, getChatOptions, sendChat, steerChat, stopChat, type ChatStreamEvent, type ReasoningEffort } from '../../api/chat';
import { uploadFile } from '../../api/files';
import { listSkills } from '../../api/skills';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { deleteSession, getSession, recoverSessionContext, updateSession } from '../../api/sessions';
import { listAllMessages } from '../../api/messages';
import { SourceBadge } from '../../components/SourceBadge';
import { formatCost, formatCount, formatTokens, formatTps, sessionTitle } from '../../lib/format';
import {
  conversationExportBlob,
  createConversationExport,
  exportFilename,
  type ConversationExportFormat,
} from '../../lib/conversationExport';
import {
  CHAT_RECONNECT_DELAYS_MS,
  clearChatRecovery,
  loadChatRecovery,
  saveChatRecovery,
} from '../../lib/chatRecovery';
import { saveComposerDraft, useComposerDraft } from '../../lib/composerDrafts';
import { clearBusyTurnQueue, enqueueBusyTurnMessage, loadBusyTurnQueue, removeBusyTurnMessage, type QueuedTurnMessage } from '../../lib/busyTurnQueue';
import { updateUiPreferences, useUiPreferences } from '../../lib/uiPreferences';
import { appendLiveActivity, parseLiveActivityData, type LiveActivityEvent } from '../../lib/liveActivity';
import { filterAndGroupSkills, type SkillCommandExchange } from '../../lib/skillSlashCommand';
import { Transcript } from './transcript/Transcript';
import { ChatComposer } from './ChatComposer';
import { LiveTurnActivity } from './LiveTurnActivity';

export default function SessionPane() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [turnState, setTurnState] = useState<{ sessionId: string; known: boolean }>({ sessionId, known: false });
  const [clarify, setClarify] = useState<{ id: number; question: string; choices: unknown[] | null } | null>(null);
  const [clarifyText, setClarifyText] = useState('');
  const [approval, setApproval] = useState<{ request_id: string; command?: string; description?: string } | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [turnTps, setTurnTps] = useState<{ tps: number; outputTokens: number } | null>(null);
  const [draft, setDraft] = useComposerDraft(sessionId);
  const [exportingFormat, setExportingFormat] = useState<ConversationExportFormat | null>(null);
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [queueState, setQueueState] = useState<{ sessionId: string; messages: QueuedTurnMessage[] }>(() => ({
    sessionId,
    messages: loadBusyTurnQueue(sessionId),
  }));
  const [liveEvents, setLiveEvents] = useState<LiveActivityEvent[]>([]);
  const [compaction, setCompaction] = useState<{ phase: 'running' | 'done'; message: string } | null>(null);
  const [turnError, setTurnError] = useState<{ message: string; recoveryAvailable: boolean } | null>(null);
  const [skillCommandState, setSkillCommandState] = useState<{ sessionId: string; items: SkillCommandExchange[] }>({
    sessionId,
    items: [],
  });
  const [recoveringContext, setRecoveringContext] = useState(false);
  const raf = useRef<number | null>(null);
  const pendingText = useRef('');
  const pendingReasoning = useRef('');
  const pendingLiveEvents = useRef<LiveActivityEvent[]>([]);
  const streamingRef = useRef('');
  const reasoningRef = useRef('');
  const liveEventsRef = useRef<LiveActivityEvent[]>([]);
  const runningRef = useRef(false);
  const lastEventIdRef = useRef(0);
  const retryNowRef = useRef<() => void>(() => {});
  const drainingQueueRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  const skillCommandIdRef = useRef(0);
  const prefs = useUiPreferences();
  const queuedMessages = queueState.sessionId === sessionId ? queueState.messages : loadBusyTurnQueue(sessionId);
  const turnStateKnown = turnState.sessionId === sessionId && turnState.known;
  const skillCommands = skillCommandState.sessionId === sessionId ? skillCommandState.items : [];
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
      saveComposerDraft(sessionId, '');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      navigate('/chats', { replace: true });
    },
  });

  const selectedModel = model === undefined ? (options.data?.default_model ?? null) : model;
  const selectedProvider = provider === undefined ? (options.data?.default_provider ?? null) : provider;

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let opened = false;

    const recovered = loadChatRecovery(sessionId);
    streamingRef.current = recovered?.streaming ?? '';
    reasoningRef.current = recovered?.reasoning ?? '';
    liveEventsRef.current = recovered?.events?.length
      ? recovered.events
      : [
          ...(recovered?.reasoning ? [{ kind: 'reasoning' as const, text: recovered.reasoning }] : []),
          ...(recovered?.activity ?? []).map((text) => ({ kind: 'tool' as const, data: { value: text } })),
          ...(recovered?.streaming ? [{ kind: 'assistant' as const, text: recovered.streaming }] : []),
        ];
    runningRef.current = recovered !== null;
    lastEventIdRef.current = recovered?.lastEventId ?? 0;
    pendingText.current = '';
    pendingReasoning.current = '';
    pendingLiveEvents.current = [];
    // Synchronize React with session-scoped browser recovery state when the route changes.
    setLiveEvents(liveEventsRef.current);
    setRunning(runningRef.current);
    setShowRecoveryBanner(recovered !== null);
    setCompaction(null);
    setTurnError(null);
    setRecoveringContext(false);
    setConnection('connecting');
    setTurnState({ sessionId, known: false });
    setReconnectAttempt(0);

    const persist = () => {
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = null;
      if (!runningRef.current) return;
      saveChatRecovery(sessionId, {
        lastEventId: lastEventIdRef.current,
        streaming: streamingRef.current + pendingText.current,
        reasoning: reasoningRef.current + pendingReasoning.current,
        activity: [],
        events: appendLiveActivity(liveEventsRef.current, pendingLiveEvents.current),
      });
    };
    const schedulePersist = () => {
      if (persistTimer === null) persistTimer = setTimeout(persist, 1_000);
    };
    const flush = () => {
      raf.current = null;
      if (pendingText.current) {
        const next = pendingText.current;
        pendingText.current = '';
        streamingRef.current += next;
      }
      if (pendingReasoning.current) {
        const next = pendingReasoning.current;
        pendingReasoning.current = '';
        reasoningRef.current += next;
      }
      if (pendingLiveEvents.current.length > 0) {
        const additions = pendingLiveEvents.current;
        pendingLiveEvents.current = [];
        liveEventsRef.current = appendLiveActivity(liveEventsRef.current, additions);
        setLiveEvents(liveEventsRef.current);
      }
      schedulePersist();
    };
    const schedule = () => {
      if (raf.current === null) raf.current = requestAnimationFrame(flush);
    };
    const refreshCanonical = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.all(sessionId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all }),
    ]);
    const terminal = () => {
      flush();
      runningRef.current = false;
      setRunning(false);
      setClarify(null);
      setApproval(null);
      clearChatRecovery(sessionId);
      setShowRecoveryBanner(false);
      void refreshCanonical().then(() => {
        if (disposed) return;
        streamingRef.current = '';
        reasoningRef.current = '';
        liveEventsRef.current = [];
        setLiveEvents([]);
      });
    };
    const finish = (event: Event) => {
      if (event instanceof MessageEvent && event.data) {
        const payload = JSON.parse(event.data) as { late_steer?: string | null; tps?: number; output_tokens?: number };
        if (payload.late_steer) setDraft((value) => value || payload.late_steer || '');
        setTurnTps(payload.tps !== undefined && payload.output_tokens !== undefined
          ? { tps: payload.tps, outputTokens: payload.output_tokens }
          : null);
      }
      setLiveTps(null);
      terminal();
    };

    const rememberEvent = (event: Event) => {
      const id = Number((event as MessageEvent).lastEventId);
      if (Number.isSafeInteger(id) && id > lastEventIdRef.current) lastEventIdRef.current = id;
      schedulePersist();
    };
    const tracked = (handler: (event: Event) => void) => (event: Event) => {
      rememberEvent(event);
      handler(event);
    };

    const connect = () => {
      if (disposed) return;
      source?.close();
      const currentSource = new EventSource(chatStreamUrl(sessionId, lastEventIdRef.current));
      source = currentSource;
      currentSource.onopen = () => {
        if (disposed || source !== currentSource) return;
        const wasReconnect = opened || attempt > 0;
        opened = true;
        attempt = 0;
        setReconnectAttempt(0);
        setConnection('live');
        if (wasReconnect) void refreshCanonical();
      };
      currentSource.addEventListener('state', tracked((event) => {
        const state = JSON.parse((event as MessageEvent).data) as { running: boolean; recovery_available?: boolean };
        setTurnState({ sessionId, known: true });
        runningRef.current = state.running;
        setRunning(state.running);
        if (state.recovery_available) {
          setTurnError({
            message: 'The conversation is too large to compress safely in place.',
            recoveryAvailable: true,
          });
        }
        // A missed terminal frame is recovered from durable canonical history.
        if (!state.running) terminal();
        else schedulePersist();
      }));
      currentSource.addEventListener('started', tracked((event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { operation?: string };
        runningRef.current = true;
        setTurnState({ sessionId, known: true });
        streamingRef.current = '';
        reasoningRef.current = '';
        liveEventsRef.current = [];
        pendingText.current = '';
        pendingReasoning.current = '';
        pendingLiveEvents.current = [];
        setRunning(true);
        setLiveEvents([]);
        setShowRecoveryBanner(false);
        setLiveTps(null);
        setTurnTps(null);
        setTurnError(null);
        setCompaction(payload.operation === 'compact'
          ? { phase: 'running', message: 'Compacting context — summarizing earlier conversation…' }
          : null);
        persist();
      }));
      currentSource.addEventListener('delta', tracked((event) => {
        const data = JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string; tps?: number };
        pendingText.current += data.text;
        pendingLiveEvents.current.push({ kind: 'assistant', text: data.text });
        if (data.tps !== undefined) setLiveTps(data.tps);
        schedule();
      }));
      currentSource.addEventListener('reasoning', tracked((event) => {
        const text = (JSON.parse((event as MessageEvent).data) as ChatStreamEvent & { text: string }).text;
        pendingReasoning.current += text;
        pendingLiveEvents.current.push({ kind: 'reasoning', text });
        schedule();
      }));
      currentSource.addEventListener('clarify', tracked((event) => setClarify(JSON.parse((event as MessageEvent).data) as { id: number; question: string; choices: unknown[] | null })));
      currentSource.addEventListener('approval', tracked((event) => setApproval(JSON.parse((event as MessageEvent).data) as { request_id: string; command?: string; description?: string })));
      currentSource.addEventListener('approval_resolved', tracked(() => setApproval(null)));
      currentSource.addEventListener('tool', tracked((event) => {
        pendingLiveEvents.current.push({ kind: 'tool', data: parseLiveActivityData((event as MessageEvent).data) });
        schedule();
      }));
      currentSource.addEventListener('subagent', tracked((event) => {
        pendingLiveEvents.current.push({ kind: 'subagent', data: parseLiveActivityData((event as MessageEvent).data) });
        schedule();
      }));
      currentSource.addEventListener('status', tracked((event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { kind?: string; message?: string };
        if (payload.kind === 'compacting') {
          setCompaction({ phase: 'running', message: payload.message || 'Compacting context…' });
        } else if (payload.kind === 'compacted') {
          setCompaction({ phase: 'done', message: payload.message || 'Context compaction complete.' });
        }
      }));
      currentSource.addEventListener('compaction', tracked((event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { before_messages?: number; after_messages?: number };
        const counts = payload.before_messages !== undefined && payload.after_messages !== undefined
          ? ` (${payload.before_messages} → ${payload.after_messages} active messages)`
          : '';
        setCompaction({ phase: 'done', message: `Context compaction complete${counts}.` });
      }));
      currentSource.addEventListener('done', tracked(finish));
      currentSource.addEventListener('cancel', tracked(finish));
      currentSource.addEventListener('error', (event) => {
        if (event instanceof MessageEvent && event.data) {
          rememberEvent(event);
          const payload = JSON.parse(event.data) as { message?: string; error_type?: string; recovery_available?: boolean };
          setTurnError({
            message: payload.message || 'The Hermes turn failed.',
            recoveryAvailable: payload.error_type === 'compression_exhausted' || payload.recovery_available === true,
          });
          if (payload.error_type === 'compaction_failed') setCompaction(null);
          finish(event);
          return;
        }
        currentSource.close();
        if (disposed || source !== currentSource || retryTimer !== null) return;
        setConnection('reconnecting');
        void refreshCanonical();
        const index = Math.min(attempt, CHAT_RECONNECT_DELAYS_MS.length - 1);
        const delay = CHAT_RECONNECT_DELAYS_MS[index];
        attempt += 1;
        setReconnectAttempt(index + 1);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, delay);
      });
    };

    retryNowRef.current = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      connect();
      void refreshCanonical();
    };
    connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (persistTimer !== null) clearTimeout(persistTimer);
      if (runningRef.current) persist();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [sessionId, queryClient, setDraft]);

  const start = useCallback(async (text: string) => {
    clearChatRecovery(sessionId);
    setShowRecoveryBanner(false);
    await sendChat(sessionId, {
      message: text,
      model: selectedModel,
      provider: selectedProvider,
      reasoning_effort: reasoningEffort,
    });
    streamingRef.current = '';
    reasoningRef.current = '';
    liveEventsRef.current = [];
    pendingText.current = '';
    pendingReasoning.current = '';
    pendingLiveEvents.current = [];
    runningRef.current = true;
    setTurnState({ sessionId, known: true });
    setLiveEvents([]);
    setTurnError(null);
    setCompaction(null);
    setRunning(true);
  }, [reasoningEffort, selectedModel, selectedProvider, sessionId]);

  useEffect(() => {
    const next = queuedMessages[0];
    if (!turnStateKnown || running || !next || drainingQueueRef.current?.sessionId === sessionId) return;
    drainingQueueRef.current = { sessionId, messageId: next.id };
    const sendWhenReleased = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await start(next.text);
          return;
        } catch (error) {
          // A terminal SSE frame can reach the browser just before the server releases its
          // active-turn slot. Retry that narrow hand-off race without dropping the queue item.
          if (!isApiError(error, 409) || attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    };
    void sendWhenReleased()
      .then(() => {
        setQueueState({ sessionId, messages: removeBusyTurnMessage(sessionId, next.id) });
        notifications.show({ color: 'green', message: 'Queued message started' });
      })
      .catch((error: unknown) => {
        notifications.show({
          color: 'red',
          message: error instanceof Error ? `Queued message could not start: ${error.message}` : 'Queued message could not start',
        });
      })
      .finally(() => {
        if (drainingQueueRef.current?.sessionId === sessionId && drainingQueueRef.current.messageId === next.id) {
          drainingQueueRef.current = null;
        }
      });
  }, [queuedMessages, running, sessionId, start, turnStateKnown]);

  const compact = async (focusTopic: string | null) => {
    clearChatRecovery(sessionId);
    setTurnError(null);
    setCompaction({ phase: 'running', message: focusTopic
      ? `Compacting context with focus: ${focusTopic}`
      : 'Compacting context — summarizing earlier conversation…' });
    try {
      await compactChat(sessionId, {
        focus_topic: focusTopic,
        model: selectedModel,
        provider: selectedProvider,
      });
      runningRef.current = true;
      setRunning(true);
      return true;
    } catch (error) {
      setCompaction(null);
      setTurnError({ message: error instanceof Error ? error.message : 'Context compaction failed.', recoveryAvailable: false });
      return false;
    }
  };

  const showSkills = async (filter: string | null) => {
    const command = filter ? `/skills ${filter}` : '/skills';
    const id = ++skillCommandIdRef.current;
    let exchange: SkillCommandExchange;
    try {
      const response = await listSkills();
      const groups = filterAndGroupSkills(response.items, filter);
      exchange = {
        id,
        command,
        query: filter,
        groups,
        matchCount: groups.reduce((count, group) => count + group.skills.length, 0),
        error: null,
      };
    } catch (error) {
      exchange = {
        id,
        command,
        query: filter,
        groups: [],
        matchCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
    setSkillCommandState((current) => ({
      sessionId,
      items: [...(current.sessionId === sessionId ? current.items : []), exchange],
    }));
    return true;
  };

  const recoverContext = async () => {
    setRecoveringContext(true);
    try {
      const continuation = await recoverSessionContext(sessionId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      navigate(`/chats/${encodeURIComponent(continuation.id)}`);
    } catch (error) {
      notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not start focused continuation' });
    } finally {
      setRecoveringContext(false);
    }
  };

  const downloadConversation = async (format: ConversationExportFormat) => {
    if (!query.data || exportingFormat) return;
    setExportingFormat(format);
    try {
      const messages = await listAllMessages(sessionId);
      const data = createConversationExport(query.data, messages);
      const blob = conversationExportBlob(data, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFilename(query.data, format === 'markdown' ? 'md' : format);
      anchor.click();
      URL.revokeObjectURL(url);
      notifications.show({ color: 'green', message: `Conversation downloaded as ${format === 'markdown' ? 'Markdown' : format.toUpperCase()}` });
    } catch (error) {
      notifications.show({
        color: 'red',
        message: error instanceof Error ? `Could not download conversation: ${error.message}` : 'Could not download conversation',
      });
    } finally {
      setExportingFormat(null);
    }
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
            <Menu position="bottom-end" shadow="md" width={190}>
              <Menu.Target>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<IconDownload size={13} />}
                  rightSection={<IconChevronDown size={11} />}
                  loading={exportingFormat !== null}
                >
                  Download
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Download conversation</Menu.Label>
                <Menu.Item leftSection={<IconFileCode size={15} />} onClick={() => void downloadConversation('json')}>
                  JSON
                </Menu.Item>
                <Menu.Item leftSection={<IconFileText size={15} />} onClick={() => void downloadConversation('markdown')}>
                  Markdown
                </Menu.Item>
                <Menu.Item leftSection={<IconFileText size={15} />} onClick={() => void downloadConversation('pdf')}>
                  PDF
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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

      <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {(showRecoveryBanner || connection === 'reconnecting') && (
          <Alert
            m="sm"
            color="yellow"
            title={connection === 'reconnecting' ? 'Connection interrupted' : 'Response restored'}
            role="status"
          >
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">
                {connection === 'reconnecting'
                  ? `Reconnecting to the live response (attempt ${reconnectAttempt}/${CHAT_RECONNECT_DELAYS_MS.length}). Your partial response is saved in this browser.`
                  : 'A response was in progress when you last left. The saved partial response is shown while Astra refreshes canonical history.'}
              </Text>
              <Group gap="xs">
                {showRecoveryBanner && (
                  <Button size="compact-xs" variant="subtle" onClick={() => {
                    setShowRecoveryBanner(false);
                    clearChatRecovery(sessionId);
                  }}>Dismiss</Button>
                )}
                <Button size="compact-xs" variant="light" leftSection={<IconRefresh size={13} />} onClick={() => retryNowRef.current()}>
                  Refresh now
                </Button>
              </Group>
            </Group>
          </Alert>
        )}
        <Box style={{ flex: 1, minHeight: 0 }}>
          <Transcript
            sessionId={sessionId}
            highlightMessageId={highlightMessageId}
            running={running}
            model={selectedModel}
            provider={selectedProvider}
            reasoningEffort={reasoningEffort}
            sessionTokens={s.input_tokens + s.output_tokens}
            sessionCostUsd={s.estimated_cost_usd}
            activityDisplayMode={prefs.activityDisplayMode}
            skillCommands={skillCommands}
          />
        </Box>
      </Box>
      <Box style={{ maxWidth: 'var(--astra-chat-content-w)', width: '100%', margin: '0 auto' }}>
        {compaction && (
          <Alert m="sm" color={compaction.phase === 'running' ? 'blue' : 'green'} title={compaction.phase === 'running' ? 'Compacting context' : 'Context compacted'} role="status">
            <Group justify="space-between" wrap="wrap">
              <Text size="sm">{compaction.message}</Text>
              {compaction.phase === 'done' && <Button size="compact-xs" variant="subtle" onClick={() => setCompaction(null)}>Dismiss</Button>}
            </Group>
          </Alert>
        )}
        {turnError && (
          <Alert m="sm" color="red" title={turnError.recoveryAvailable ? 'Context compression exhausted' : 'Turn failed'}>
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">{turnError.message}</Text>
              {turnError.recoveryAvailable && (
                <Button size="xs" leftSection={<IconGitBranch size={14} />} loading={recoveringContext} onClick={() => void recoverContext()}>
                  Start focused continuation
                </Button>
              )}
            </Group>
          </Alert>
        )}
        <LiveTurnActivity events={liveEvents} mode={prefs.activityDisplayMode} />
        {liveTps !== null && (
          <Text fz={11} c="dimmed" ff="monospace" px="sm">
            {formatTps(liveTps)}
          </Text>
        )}
        {!running && turnTps && (
          <Text fz={11} c="dimmed" ff="monospace" px="sm">
            {formatTps(turnTps.tps)} · {formatCount(turnTps.outputTokens)} tokens
          </Text>
        )}
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
        {queuedMessages.length > 0 && (
          <Alert m="sm" color="blue" title={`${queuedMessages.length} message${queuedMessages.length === 1 ? '' : 's'} queued`} role="status">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">
                {running ? 'The next message will start when this turn stops or finishes.' : 'Starting the next queued message…'}
              </Text>
              {running && (
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => {
                  clearBusyTurnQueue(sessionId);
                  setQueueState({ sessionId, messages: [] });
                }}>Clear queue</Button>
              )}
            </Group>
          </Alert>
        )}
      </Box>
      <ChatComposer
        running={running}
        onSend={start}
        onStop={() => stopChat(sessionId)}
        onSteer={(text) => steerChat(sessionId, text)}
        onQueue={async (text) => {
          setQueueState({ sessionId, messages: enqueueBusyTurnMessage(sessionId, text) });
          notifications.show({ color: 'blue', message: 'Message queued for the next turn' });
        }}
        onInterrupt={async (text) => {
          setQueueState({ sessionId, messages: enqueueBusyTurnMessage(sessionId, text, { front: true }) });
          notifications.show({ color: 'blue', message: 'Stopping this turn; your message will start next' });
          try {
            await stopChat(sessionId);
          } catch (error) {
            if (!isApiError(error, 409)) {
              notifications.show({
                color: 'yellow',
                message: 'Could not stop the current turn; your message remains queued',
              });
            }
          }
        }}
        onCompact={compact}
        onSkills={showSkills}
        model={selectedModel}
        provider={selectedProvider}
        models={options.data?.models ?? (s.model ? [{ name: s.model, provider: null }] : [])}
        providers={options.data?.providers ?? []}
        defaultModel={options.data?.default_model ?? null}
        onModelChange={setModel}
        onProviderChange={setProvider}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={setReasoningEffort}
        draft={draft}
        onDraftChange={setDraft}
        onAttach={async (file) => (await uploadFile({ directory: '', file })).path}
        liveTps={liveTps}
        busyTurnMode={prefs.busyTurnMode}
        onBusyTurnModeChange={(busyTurnMode) => updateUiPreferences({ busyTurnMode })}
        contextTokens={s.context_tokens}
        contextLength={s.context_length}
        contextEstimated={s.context_tokens_estimated}
      />
    </Box>
  );
}

import { ActionIcon, Alert, Center, Loader, Text, Tooltip } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getChildSessions, listMessages, MESSAGE_PAGE_SIZE } from '../../../api/messages';
import type { ReasoningEffort } from '../../../api/chat';
import { queryKeys } from '../../../api/queryKeys';
import type { SkillCommandExchange } from '../../../lib/skillSlashCommand';
import { buildToolResultIndex } from '../../../lib/transcript';
import { scrollBehavior } from '../../../lib/motion';
import type { ActivityDisplayMode } from '../../../lib/uiPreferences';
import { buildTranscriptEntries, type ActivityBlock, type TranscriptEntry } from '../../../lib/turnBlocks';
import { MessageRow } from './MessageRow';
import { isLiveAnswerCanonical, type LiveTurn } from '../../../lib/liveTurn';
import { LiveTurnRow } from './LiveTurnRow';
import { AssistantBlockRow, type BlockContext } from './AssistantBlockRow';
import { SkillCommandResult } from './SkillCommandResult';
import classes from './Transcript.module.css';

interface PageParam {
  before_id?: number;
  after_id?: number;
  around_id?: number;
}

type Row =
  | { key: string; kind: 'loader-top' | 'loader-bottom' }
  | { key: string; kind: 'entry'; entry: TranscriptEntry; last: boolean; continued: boolean }
  | { key: string; kind: 'live'; turn: LiveTurn; avatar: boolean; leading: ActivityBlock | null }
  | { key: string; kind: 'skill-command'; exchange: SkillCommandExchange };

const NEAR_EDGE_PX = 400;
const NEAR_BOTTOM_PX = 200;
const EMPTY_SKILL_COMMANDS: SkillCommandExchange[] = [];

export const Transcript = memo(function Transcript({
  sessionId,
  highlightMessageId,
  running = false,
  model,
  provider,
  reasoningEffort,
  sessionTokens = 0,
  sessionCostUsd = null,
  activityDisplayMode = 'compact_worklog',
  skillCommands = EMPTY_SKILL_COMMANDS,
  liveTurn = null,
  livePrompts = null,
  onRetryLiveTurn,
}: {
  sessionId: string;
  highlightMessageId?: number;
  running?: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  sessionTokens?: number;
  sessionCostUsd?: number | null;
  activityDisplayMode?: ActivityDisplayMode;
  skillCommands?: SkillCommandExchange[];
  liveTurn?: LiveTurn | null;
  /** Clarify/approval cards for the live turn, rendered where the turn paused. */
  livePrompts?: ReactNode;
  onRetryLiveTurn?: () => void;
}) {
  const navigate = useNavigate();
  const initialParam = useMemo<PageParam>(
    () => (highlightMessageId ? { around_id: highlightMessageId } : {}),
    [highlightMessageId],
  );

  const query = useInfiniteQuery({
    queryKey: queryKeys.messages.window(sessionId, highlightMessageId),
    queryFn: ({ pageParam, signal }) =>
      listMessages(sessionId, { limit: MESSAGE_PAGE_SIZE, ...pageParam }, signal),
    initialPageParam: initialParam,
    getNextPageParam: (lastPage): PageParam | undefined =>
      lastPage.has_newer && lastPage.newest_id !== null ? { after_id: lastPage.newest_id } : undefined,
    getPreviousPageParam: (firstPage): PageParam | undefined =>
      firstPage.has_older && firstPage.oldest_id !== null ? { before_id: firstPage.oldest_id } : undefined,
  });

  const childrenQuery = useQuery({
    queryKey: queryKeys.messages.children(sessionId),
    queryFn: ({ signal }) => getChildSessions(sessionId, signal),
    staleTime: 60_000,
  });
  const childSessions = useMemo(() => childrenQuery.data?.items ?? [], [childrenQuery.data]);

  const messages = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const toolResults = useMemo(() => buildToolResultIndex(messages), [messages]);
  const entries = useMemo(() => buildTranscriptEntries(messages, toolResults), [messages, toolResults]);
  const blockContext = useMemo<BlockContext>(
    () => ({ sessionId, childSessions, activityDisplayMode }),
    [sessionId, childSessions, activityDisplayMode],
  );

  const { hasPreviousPage, hasNextPage, isFetchingPreviousPage, isFetchingNextPage, fetchPreviousPage, fetchNextPage } =
    query;

  const liveVisible = !!liveTurn && !hasNextPage && !isLiveAnswerCanonical(messages, liveTurn);
  // A live turn with no user text of its own continues the saved turn above it (the saved rows
  // are the durable part of the same turn): one avatar, one activity group, actions only at the end.
  const lastEntry = entries.at(-1);
  const liveContinues = liveVisible && liveTurn?.userText === null && lastEntry?.kind === 'block';

  const canonicalRows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (hasPreviousPage) list.push({ key: 'loader-top', kind: 'loader-top' });
    let previous: TranscriptEntry | null = null;
    for (const entry of entries) {
      const continued = entry.kind === 'block' && !entry.first && previous?.kind === 'block';
      list.push({ key: entry.key, kind: 'entry', entry, last: entry.kind === 'block' && entry.last, continued });
      previous = entry;
    }
    if (hasNextPage) list.push({ key: 'loader-bottom', kind: 'loader-bottom' });
    return list;
  }, [entries, hasPreviousPage, hasNextPage]);

  // While the live turn continues the saved one, the saved turn has not ended yet, and a trailing
  // saved activity group is handed to the live row so its steps and the live steps form one group.
  const continuation = useMemo(() => {
    const tail = canonicalRows.at(-1);
    if (!liveContinues || tail?.kind !== 'entry' || tail.entry.kind !== 'block') {
      return { rows: canonicalRows, leading: null as ActivityBlock | null, avatar: !liveContinues };
    }
    if (tail.entry.block.kind === 'activity') {
      return { rows: canonicalRows.slice(0, -1), leading: tail.entry.block, avatar: tail.entry.first };
    }
    return { rows: [...canonicalRows.slice(0, -1), { ...tail, last: false }], leading: null, avatar: false };
  }, [canonicalRows, liveContinues]);

  const rows = useMemo<Row[]>(() => {
    const list = continuation.rows.slice();
    for (const exchange of skillCommands) {
      list.push({ key: `skills-${exchange.id}`, kind: 'skill-command', exchange });
    }
    if (liveVisible && liveTurn) {
      list.push({ key: 'live-turn', kind: 'live', turn: liveTurn, avatar: continuation.avatar, leading: continuation.leading });
    }
    return list;
  }, [continuation, skillCommands, liveVisible, liveTurn]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // Scroll anchoring. `nearBottom` measures geometry, and geometry cannot express intent: this list
  // is virtualized, so its height is recomputed as rows are measured and the bottom moves away from
  // a reader who never scrolled. Reading that as "the reader left the bottom" is what silently
  // stopped the stream from following. Intent is therefore tracked separately, and the only scroll
  // offset that does not count as intent is the one this component set itself.
  const [following, setFollowing] = useState(true);
  // The offset our own anchoring produced, so the scroll event it triggers is not mistaken for the
  // reader moving the viewport. Consumed by the first scroll event that observes it.
  const anchoredScrollTopRef = useRef<number | null>(null);

  const anchorToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) el.scrollTop = el.scrollHeight;
    // Read back the offset the browser actually applied, which clamps to the scrollable range.
    anchoredScrollTopRef.current = el.scrollTop;
  }, []);

  // A different conversation starts out following its own tail.
  const followedSessionRef = useRef(sessionId);
  useEffect(() => {
    if (followedSessionRef.current === sessionId) return;
    followedSessionRef.current = sessionId;
    anchoredScrollTopRef.current = null;
    setFollowing(true);
  }, [sessionId]);

  // Prepending older messages must not move the content already on screen: capture the scroll
  // container's height before the fetch, then add back exactly what grew above the fold.
  const prependingRef = useRef(false);
  const heightBeforePrependRef = useRef(0);

  const loadOlder = useCallback(() => {
    if (!hasPreviousPage || isFetchingPreviousPage || prependingRef.current) return;
    prependingRef.current = true;
    heightBeforePrependRef.current = scrollRef.current?.scrollHeight ?? 0;
    void fetchPreviousPage().finally(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          const delta = el.scrollHeight - heightBeforePrependRef.current;
          if (delta > 0) el.scrollTop += delta;
        }
        prependingRef.current = false;
      });
    });
  }, [hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage]);

  // Initial position: bottom of the latest window, or (below) the highlighted message.
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || query.isPending) return;
    didInitialScrollRef.current = true;
    if (highlightMessageId) return;
    anchorToBottom();
  }, [query.isPending, highlightMessageId, anchorToBottom]);

  const didHighlightScrollRef = useRef(false);
  useEffect(() => {
    if (!highlightMessageId || didHighlightScrollRef.current) return;
    const index = rows.findIndex((r) => r.kind === 'entry' && (r.entry.kind === 'message'
      ? r.entry.message.id === highlightMessageId
      : r.entry.messageIds.includes(highlightMessageId)));
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'center' });
    didHighlightScrollRef.current = true;
  }, [rows, highlightMessageId, virtualizer]);

  const [nearBottom, setNearBottom] = useState(true);
  const totalSize = virtualizer.getTotalSize();
  const lastRowKey = rows.at(-1)?.key;
  const lastRowSize = liveTurn ? `${liveTurn.answer.length}:${liveTurn.reasoning.length}:${liveTurn.events.length}` : '';

  // A following reader stays pinned as the list grows. Anchoring here, rather than only once the
  // geometry happens to report the bottom, is what keeps a stream following after the list has been
  // re-measured — before any scroll event has had the chance to report the new height.
  useLayoutEffect(() => {
    if (!following || !didInitialScrollRef.current || prependingRef.current || highlightMessageId) return;
    anchorToBottom();
  }, [following, lastRowKey, lastRowSize, totalSize, highlightMessageId, anchorToBottom]);

  const lastSkillCommandId = skillCommands.at(-1)?.id;
  useEffect(() => {
    if (lastSkillCommandId === undefined || !following) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() });
    });
  }, [lastSkillCommandId, following]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    const atBottom = distance < NEAR_BOTTOM_PX;
    const anchored = anchoredScrollTopRef.current;
    anchoredScrollTopRef.current = null;
    // Landing where this component deliberately anchored says nothing about the reader; anywhere
    // else the viewport went, the reader put it there.
    if (anchored === null || Math.abs(top - anchored) > 1) setFollowing(atBottom);
    setNearBottom(atBottom);
    if (top < NEAR_EDGE_PX) loadOlder();
    if (distance < NEAR_EDGE_PX && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [loadOlder, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const jumpToLatest = useCallback(() => {
    if (hasNextPage) {
      // The loaded window doesn't reach the true latest message (a deep link into the middle of
      // history) — a fresh "latest" fetch is cheaper and simpler than paging through everything.
      navigate(`/chats/${encodeURIComponent(sessionId)}`, { replace: true });
      return;
    }
    // An explicit request to follow, so the stream resumes tracking the tail.
    setFollowing(true);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() });
  }, [hasNextPage, navigate, sessionId]);

  if (query.isPending) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Center h="100%" p="md">
        <Alert color="red" title="Failed to load messages">
          {query.error instanceof Error ? query.error.message : 'Unknown error'}
        </Alert>
      </Center>
    );
  }
  if (messages.length === 0 && skillCommands.length === 0 && !liveTurn) {
    return (
      <Center h="100%">
        <Text c="dimmed" size="sm">
          No messages in this conversation.
        </Text>
      </Center>
    );
  }

  return (
    <div className={classes.root} ref={scrollRef} onScroll={onScroll} data-testid="transcript-scroller">
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
              className={classes.rowWrapper}
              data-continued={row.kind === 'entry' && row.continued ? true : undefined}
              data-user={row.kind === 'entry' && row.entry.kind === 'message' && row.entry.message.role === 'user' ? true : undefined}
            >
              <div className={classes.rowInner}>
                {(row.kind === 'loader-top' || row.kind === 'loader-bottom') && (
                  <div className={classes.centerLoader}>
                    <Loader size="xs" />
                  </div>
                )}
                {row.kind === 'entry' && row.entry.kind === 'message' && (
                  <MessageRow
                    message={row.entry.message}
                    sessionId={sessionId}
                    highlighted={row.entry.message.id === highlightMessageId}
                    running={running}
                    model={model}
                    provider={provider}
                    reasoningEffort={reasoningEffort}
                    sessionTokens={sessionTokens}
                    sessionCostUsd={sessionCostUsd}
                  />
                )}
                {row.kind === 'entry' && row.entry.kind === 'block' && (
                  <AssistantBlockRow
                    entry={row.entry}
                    last={row.last}
                    context={blockContext}
                    highlighted={highlightMessageId !== undefined && row.entry.messageIds.includes(highlightMessageId)}
                    running={running}
                    model={model}
                    provider={provider}
                    reasoningEffort={reasoningEffort}
                    sessionTokens={sessionTokens}
                    sessionCostUsd={sessionCostUsd}
                  />
                )}
                {row.kind === 'skill-command' && <SkillCommandResult exchange={row.exchange} />}
                {row.kind === 'live' && (
                  <LiveTurnRow
                    turn={row.turn}
                    context={blockContext}
                    avatar={row.avatar}
                    leading={row.leading}
                    prompts={livePrompts}
                    onRetry={onRetryLiveTurn}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!nearBottom && (
        <Tooltip label="Jump to latest">
          <ActionIcon
            className={classes.jumpToLatest}
            radius="xl"
            size="lg"
            variant="filled"
            onClick={jumpToLatest}
            aria-label="Jump to latest"
          >
            <IconArrowDown size={18} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
});

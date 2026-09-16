import { ActionIcon, Alert, Center, Loader, Text, Tooltip } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { getChildSessions, listMessages, MESSAGE_PAGE_SIZE } from '../../../api/messages';
import { queryKeys } from '../../../api/queryKeys';
import type { Message } from '../../../api/types';
import { buildToolResultIndex } from '../../../lib/transcript';
import { MessageRow } from './MessageRow';
import classes from './Transcript.module.css';

interface PageParam {
  before_id?: number;
  after_id?: number;
  around_id?: number;
}

type Row =
  | { key: string; kind: 'loader-top' | 'loader-bottom' }
  | { key: string; kind: 'message'; message: Message };

const NEAR_EDGE_PX = 400;
const NEAR_BOTTOM_PX = 200;

export function Transcript({
  sessionId,
  highlightMessageId,
}: {
  sessionId: string;
  highlightMessageId?: number;
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
  const consumedToolCallIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const call of m.tool_calls) if (call.id) set.add(call.id);
      }
    }
    return set;
  }, [messages]);

  const { hasPreviousPage, hasNextPage, isFetchingPreviousPage, isFetchingNextPage, fetchPreviousPage, fetchNextPage } =
    query;

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (hasPreviousPage) list.push({ key: 'loader-top', kind: 'loader-top' });
    for (const m of messages) list.push({ key: `m-${m.id}`, kind: 'message', message: m });
    if (hasNextPage) list.push({ key: 'loader-bottom', kind: 'loader-bottom' });
    return list;
  }, [messages, hasPreviousPage, hasNextPage]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

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
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [query.isPending, highlightMessageId]);

  const didHighlightScrollRef = useRef(false);
  useEffect(() => {
    if (!highlightMessageId || didHighlightScrollRef.current) return;
    const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === highlightMessageId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'center' });
    didHighlightScrollRef.current = true;
  }, [rows, highlightMessageId, virtualizer]);

  const [nearBottom, setNearBottom] = useState(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
    if (el.scrollTop < NEAR_EDGE_PX) loadOlder();
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_EDGE_PX &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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
  if (messages.length === 0) {
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
            >
              {(row.kind === 'loader-top' || row.kind === 'loader-bottom') && (
                <div className={classes.centerLoader}>
                  <Loader size="xs" />
                </div>
              )}
              {row.kind === 'message' && (
                <MessageRow
                  message={row.message}
                  toolResults={toolResults}
                  consumedToolCallIds={consumedToolCallIds}
                  childSessions={childSessions}
                  highlighted={row.message.id === highlightMessageId}
                />
              )}
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
}

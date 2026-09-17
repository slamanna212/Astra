import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  MultiSelect,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronRight, IconMessage, IconPlus } from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getChildSessions } from '../../api/messages';
import { queryKeys } from '../../api/queryKeys';
import { createSession, listSessions, SESSION_PAGE_SIZE } from '../../api/sessions';
import type { ChildSession, SessionStatus, SessionSummary } from '../../api/types';
import { SourceBadge } from '../../components/SourceBadge';
import { KNOWN_SOURCES } from '../../lib/sources';
import { useNow } from '../../hooks/useNow';
import { formatCount, formatDateTime, formatRelativeTime, sessionTitle } from '../../lib/format';
import classes from './SessionList.module.css';

export const SESSION_ROW_HEIGHT = 64;
/** Condensed row for a nested sub-agent session (title + timestamp only, no meta line). */
export const SESSION_CHILD_ROW_HEIGHT = 48;
/** Start fetching the next page when the last rendered row is within this many rows of the end. */
const LOAD_MORE_THRESHOLD = 10;

const SOURCE_OPTIONS = KNOWN_SOURCES.map((s) => ({ value: s, label: s }));

const STATUS_OPTIONS: { value: SessionStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'all', label: 'All' },
];

interface SessionRowProps {
  session: SessionSummary;
  active: boolean;
  now: number;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
}

const SessionRow = memo(function SessionRow({ session, active, now, expanded, onToggleExpanded }: SessionRowProps) {
  const lastActivity = session.last_activity_at ?? session.started_at;
  const hasChildren = session.child_count > 0;
  return (
    <UnstyledButton
      component={Link}
      to={`/chats/${encodeURIComponent(session.id)}`}
      className={classes.row}
      // Pixel height (not a Mantine rem prop) so it matches the virtualizer's pixel math.
      style={{ height: SESSION_ROW_HEIGHT }}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      data-testid="session-row"
    >
      <Group gap={6} wrap="nowrap">
        {session.pinned && (
          <Text component="span" c="sand" fz={11} style={{ flexShrink: 0 }} aria-label="Pinned">
            ★
          </Text>
        )}
        <Text size="sm" fw={500} truncate="end" style={{ flex: 1, minWidth: 0 }}>
          {sessionTitle(session)}
        </Text>
        <Text component="span" className={classes.meta} style={{ flexShrink: 0 }} title={formatDateTime(lastActivity)}>
          {formatRelativeTime(lastActivity, now)}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        <SourceBadge source={session.source} />
        {session.archived && (
          <Badge size="xs" variant="outline" color="gray" radius="xl">
            archived
          </Badge>
        )}
        {session.hidden && (
          <Badge size="xs" variant="outline" color="gray" radius="xl">
            hidden
          </Badge>
        )}
        {hasChildren && (
          <UnstyledButton
            className={classes.expandToggle}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleExpanded(session.id);
            }}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${session.child_count} sub-agent${session.child_count === 1 ? '' : 's'}`}
          >
            <Group gap={4} wrap="nowrap">
              <IconChevronRight
                size={11}
                style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
              />
              <Text component="span" className={classes.meta}>
                {session.child_count} sub-agent{session.child_count === 1 ? '' : 's'}
              </Text>
            </Group>
          </UnstyledButton>
        )}
        <Group gap={3} wrap="nowrap" ml="auto">
          <IconMessage size={12} aria-hidden color="var(--astra-text-dim)" />
          <Text component="span" className={classes.meta} aria-label={`${session.message_count} messages`}>
            {formatCount(session.message_count)}
          </Text>
        </Group>
      </Group>
    </UnstyledButton>
  );
});

const SessionChildRow = memo(function SessionChildRow({
  session,
  active,
  now,
}: {
  session: ChildSession;
  active: boolean;
  now: number;
}) {
  return (
    <UnstyledButton
      component={Link}
      to={`/chats/${encodeURIComponent(session.id)}`}
      className={classes.childRow}
      style={{ height: SESSION_CHILD_ROW_HEIGHT }}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      data-testid="session-child-row"
    >
      <span className={classes.childDot} aria-hidden />
      <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>
        {sessionTitle(session)}
      </Text>
      <Text component="span" className={classes.meta} style={{ flexShrink: 0 }} title={formatDateTime(session.started_at)}>
        {formatRelativeTime(session.started_at, now)}
      </Text>
    </UnstyledButton>
  );
});

type Row =
  | { kind: 'parent'; session: SessionSummary; topIndex: number }
  | { kind: 'child'; session: ChildSession; parentId: string; topIndex: number }
  | { kind: 'child-loading'; parentId: string; topIndex: number }
  | { kind: 'loader'; topIndex: number };

function rowKey(row: Row | undefined, index: number): string {
  if (!row) return `loader-${index}`;
  switch (row.kind) {
    case 'parent':
      return row.session.id;
    case 'child':
      return `child-${row.session.id}`;
    case 'child-loading':
      return `child-loading-${row.parentId}`;
    case 'loader':
      return `loader-${index}`;
  }
}

export function SessionList({ selectedId }: { selectedId?: string }) {
  const [sources, setSources] = useState<string[]>([]);
  const [status, setStatus] = useState<SessionStatus>('active');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const now = useNow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => createSession({}),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      navigate(`/chats/${encodeURIComponent(session.id)}`);
    },
  });

  const filters = useMemo(() => ({ source: sources.length ? sources : null, status }), [sources, status]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.sessions.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listSessions({ ...filters, cursor: pageParam, limit: SESSION_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sessions = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandedIds = useMemo(() => Array.from(expanded), [expanded]);
  const childQueries = useQueries({
    queries: expandedIds.map((id) => ({
      queryKey: queryKeys.messages.children(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getChildSessions(id, signal),
      staleTime: 60_000,
    })),
  });
  const childrenById = useMemo(() => {
    const map = new Map<string, { items: ChildSession[]; isLoading: boolean }>();
    expandedIds.forEach((id, i) => {
      const q = childQueries[i];
      map.set(id, { items: q?.data?.items ?? [], isLoading: q?.isLoading ?? true });
    });
    return map;
  }, [expandedIds, childQueries]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    sessions.forEach((session, topIndex) => {
      out.push({ kind: 'parent', session, topIndex });
      if (expanded.has(session.id)) {
        const entry = childrenById.get(session.id);
        if (!entry || entry.isLoading) {
          out.push({ kind: 'child-loading', parentId: session.id, topIndex });
        } else {
          entry.items.forEach((child) => {
            out.push({ kind: 'child', session: child, parentId: session.id, topIndex });
          });
        }
      }
    });
    if (hasNextPage) out.push({ kind: 'loader', topIndex: sessions.length });
    return out;
  }, [sessions, expanded, childrenById, hasNextPage]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // TanStack Virtual returns unstable functions by design; the React Compiler lint knows this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'child' ? SESSION_CHILD_ROW_HEIGHT : SESSION_ROW_HEIGHT),
    overscan: 8,
    getItemKey: (index) => rowKey(rows[index], index),
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1]!.index : -1;

  useEffect(() => {
    if (lastIndex < 0 || !hasNextPage || isFetchingNextPage) return;
    const topIndex = rows[lastIndex]?.topIndex ?? sessions.length;
    if (topIndex >= sessions.length - LOAD_MORE_THRESHOLD) {
      void fetchNextPage();
    }
  }, [lastIndex, rows, sessions.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Reset scroll when filters change so we don't sit past the end of a shorter list.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filters]);

  return (
    <>
      <Stack gap={8} p="sm" style={{ borderBottom: '1px solid var(--astra-divider)' }}>
        <Button fullWidth leftSection={<IconPlus size={14} />} loading={create.isPending} onClick={() => create.mutate()}>
          New chat
        </Button>
        <MultiSelect
          aria-label="Filter by conversation type"
          placeholder="All types"
          data={SOURCE_OPTIONS}
          value={sources}
          onChange={setSources}
          clearable
        />
        <SegmentedControl
          size="xs"
          fullWidth
          data={STATUS_OPTIONS}
          value={status}
          onChange={(value) => setStatus(value as SessionStatus)}
        />
      </Stack>

      {query.isPending ? (
        <Center p="xl">
          <Loader size="sm" aria-label="Loading sessions" />
        </Center>
      ) : query.isError ? (
        <Stack align="center" p="xl" gap="xs">
          <Text size="sm" c="red">
            Failed to load sessions.
          </Text>
          <Button size="xs" variant="light" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Stack>
      ) : sessions.length === 0 ? (
        <Center p="xl">
          <Text size="sm" c="dimmed">
            No sessions.
          </Text>
        </Center>
      ) : (
        <div ref={scrollRef} className={classes.scroller} data-testid="session-list-scroller">
          <div
            role="list"
            aria-label="Sessions"
            style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={item.key}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {!row ? null : row.kind === 'parent' ? (
                    <SessionRow
                      session={row.session}
                      active={row.session.id === selectedId}
                      now={now}
                      expanded={expanded.has(row.session.id)}
                      onToggleExpanded={toggleExpanded}
                    />
                  ) : row.kind === 'child' ? (
                    <SessionChildRow session={row.session} active={row.session.id === selectedId} now={now} />
                  ) : row.kind === 'child-loading' ? (
                    <div className={classes.childIndent} style={{ height: SESSION_CHILD_ROW_HEIGHT }}>
                      <Loader size={12} aria-label="Loading sub-agents" />
                    </div>
                  ) : query.isFetchNextPageError ? (
                    <Center h="100%">
                      <Button size="xs" variant="subtle" onClick={() => void fetchNextPage()}>
                        Retry loading more
                      </Button>
                    </Center>
                  ) : (
                    <Center h="100%">
                      <Loader size="xs" aria-label="Loading more sessions" />
                    </Center>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

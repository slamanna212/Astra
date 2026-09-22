import { ActionIcon, Badge, Button, Center, Group, Loader, Menu, MultiSelect, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArchive,
  IconArrowLeft,
  IconCopy,
  IconDotsVertical,
  IconEyeOff,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getChildSessions } from '../../api/messages';
import { queryKeys } from '../../api/queryKeys';
import { countArchivedSessions, createSession, deleteSession, getSession, listSessions, SESSION_PAGE_SIZE, updateSession } from '../../api/sessions';
import type { ChildSession, SessionStatus, SessionSummary } from '../../api/types';
import { KNOWN_SOURCES, sourceColor } from '../../lib/sources';
import { useNow } from '../../hooks/useNow';
import { formatCompactAge, formatCount, formatDateTime, formatGroupDate, sessionTitle } from '../../lib/format';
import classes from './SessionList.module.css';

export const SESSION_ROW_HEIGHT = 44;
/** Nested sub-agent row: title only, no age/type dot. */
export const SESSION_CHILD_ROW_HEIGHT = 30;
/** Date/"Pinned" section header row. */
export const SESSION_GROUP_HEADER_HEIGHT = 28;
/** Start fetching the next page when the last rendered row is within this many rows of the end. */
const LOAD_MORE_THRESHOLD = 10;

const SOURCE_OPTIONS = KNOWN_SOURCES.map((s) => ({ value: s, label: s }));

/** The row's own overflow menu: same actions as the conversation header, minus Download —
    there's no room in a 44px row for a separate download trigger, and downloading a
    conversation you haven't opened yet is a rare enough need to live in the header only. */
function SessionRowMenu({ session, active }: { session: SessionSummary; active: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof updateSession>[1]) => updateSession(session.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.sessions.detail(session.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      if (active) navigate('/chats', { replace: true });
    },
  });

  const stop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Menu position="bottom-end" shadow="md" width={200} withinPortal>
      <Menu.Target>
        <ActionIcon
          size={26}
          variant="subtle"
          color="gray"
          className={classes.rowMenuTrigger}
          aria-label="Conversation actions"
          onClick={stop}
        >
          <IconDotsVertical size={15} stroke={1.7} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={stop}>
        <Menu.Label>Conversation</Menu.Label>
        <Menu.Item
          leftSection={<IconPencil size={15} />}
          onClick={() => {
            const title = window.prompt('Conversation title', session.title ?? '');
            if (title !== null) patch.mutate({ title });
          }}
        >
          Rename
        </Menu.Item>
        <Menu.Item
          leftSection={session.pinned ? <IconPinFilled size={15} color="var(--astra-accent)" /> : <IconPin size={15} />}
          onClick={() => patch.mutate({ pinned: !session.pinned })}
        >
          {session.pinned ? 'Unpin' : 'Pin'}
        </Menu.Item>
        <Menu.Item leftSection={<IconArchive size={15} />} onClick={() => patch.mutate({ archived: !session.archived })}>
          {session.archived ? 'Unarchive' : 'Archive'}
        </Menu.Item>
        <Menu.Item leftSection={<IconEyeOff size={15} />} onClick={() => patch.mutate({ hidden: !session.hidden })}>
          {session.hidden ? 'Unhide' : 'Hide from list'}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconCopy size={15} />}
          onClick={() => {
            void navigator.clipboard.writeText(session.id);
            notifications.show({ color: 'teal', message: 'Session ID copied' });
          }}
        >
          Copy session ID
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={remove.isPending ? <Loader size={14} /> : <IconTrash size={15} />}
          onClick={() => {
            if (window.confirm('Delete this conversation and its messages? This cannot be undone.')) remove.mutate();
          }}
        >
          Delete conversation
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

const SessionRow = memo(function SessionRow({ session, active, now }: { session: SessionSummary; active: boolean; now: number }) {
  const lastActivity = session.last_activity_at ?? session.started_at;
  const showStatus = session.archived || session.hidden;
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
      <span className={classes.dot} style={{ background: `var(--mantine-color-${sourceColor(session.source)}-6)` }} aria-hidden />
      {session.pinned && (
        <span role="img" aria-label="Pinned" title="Pinned" className={classes.pinIcon}>
          <IconStarFilled size={11} color="var(--astra-accent)" aria-hidden />
        </span>
      )}
      <Text
        size="sm"
        fw={400}
        truncate="end"
        className={classes.title}
        c={active ? 'var(--astra-text)' : 'var(--astra-text-body)'}
      >
        {sessionTitle(session)}
      </Text>
      {session.child_count > 0 && (
        <Badge size="xs" variant="light" color="grape" title={`${session.child_count} sub-agent session(s)`}>
          {session.child_count}
        </Badge>
      )}
      {showStatus && (
        <span className={classes.statusIcons}>
          {session.archived && (
            <span role="img" aria-label="Archived" title="Archived">
              <IconArchive size={12} color="var(--astra-text-dim)" aria-hidden />
            </span>
          )}
          {session.hidden && (
            <span role="img" aria-label="Hidden" title="Hidden">
              <IconEyeOff size={12} color="var(--astra-text-dim)" aria-hidden />
            </span>
          )}
        </span>
      )}
      <span className={classes.trailingSlot}>
        <Text component="span" className={classes.age} title={formatDateTime(lastActivity)}>
          {formatCompactAge(lastActivity, now)}
        </Text>
        <span className={classes.rowMenuSlot}>
          <SessionRowMenu session={session} active={active} />
        </span>
      </span>
    </UnstyledButton>
  );
});

const SessionChildRow = memo(function SessionChildRow({ session, active }: { session: ChildSession; active: boolean }) {
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
      <Text size="sm" truncate="end" className={classes.childTitle}>
        {sessionTitle(session)}
      </Text>
    </UnstyledButton>
  );
});

type Row =
  | { kind: 'group-header'; label: string; topIndex: number }
  | { kind: 'parent'; session: SessionSummary; topIndex: number }
  | { kind: 'child'; session: ChildSession; parentId: string; topIndex: number }
  | { kind: 'child-loading'; parentId: string; topIndex: number }
  | { kind: 'loader'; topIndex: number };

function rowKey(row: Row | undefined, index: number): string {
  if (!row) return `loader-${index}`;
  switch (row.kind) {
    case 'group-header':
      return `group-${row.label}`;
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
  const [showArchived, setShowArchived] = useState(false);
  const status: SessionStatus = showArchived ? 'archived' : 'active';
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

  // Shown as "Show N archived" above the list, and kept fresh by the same `sessions.all`
  // invalidation the list itself relies on after an archive/unarchive.
  const archivedCountQuery = useQuery({
    queryKey: queryKeys.sessions.count(filters.source),
    queryFn: ({ signal }) => countArchivedSessions(filters.source, signal),
  });
  const archivedCount = archivedCountQuery.data ?? 0;

  const query = useInfiniteQuery({
    queryKey: queryKeys.sessions.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listSessions({ ...filters, cursor: pageParam, limit: SESSION_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sessions = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Sub-agent groups are collapsed by default (the badge on the parent row shows the count) and
  // expand only for the group containing the currently selected session — its parent if a
  // sub-agent child is open, or itself if the parent is open. At most one group is ever fetched.
  const selfAsParent = useMemo(
    () => (selectedId ? sessions.find((s) => s.id === selectedId) : undefined),
    [sessions, selectedId],
  );
  // Not found among the loaded top-level sessions: selectedId may be a sub-agent child, which is
  // excluded from that list, so resolve its parent via the session detail endpoint. Shares its
  // query key/cache with SessionPane's own session-detail fetch, so this is usually free.
  const needsParentLookup = Boolean(selectedId) && !selfAsParent;
  const selectedDetailQuery = useQuery({
    queryKey: queryKeys.sessions.detail(selectedId ?? ''),
    queryFn: ({ signal }) => getSession(selectedId!, signal),
    enabled: needsParentLookup,
    staleTime: 60_000,
  });
  // Sticky rather than a plain derived memo: when selectedId switches to a different sub-agent
  // child, selectedDetailQuery's key changes and its `data` goes briefly undefined while it
  // refetches. Deriving activeParentId straight from that would collapse the group and re-expand
  // it once the lookup resolves (a visible flash). Instead we only update it once we have a
  // definitive answer, so the currently expanded group stays put while switching between siblings.
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      setActiveParentId(null);
      return;
    }
    if (selfAsParent) {
      setActiveParentId(selfAsParent.child_count > 0 ? selfAsParent.id : null);
      return;
    }
    if (!selectedDetailQuery.isFetching && selectedDetailQuery.data) {
      setActiveParentId(selectedDetailQuery.data.parent_session_id ?? null);
    }
  }, [selectedId, selfAsParent, selectedDetailQuery.isFetching, selectedDetailQuery.data]);

  const activeChildrenQuery = useQuery({
    queryKey: queryKeys.messages.children(activeParentId ?? ''),
    queryFn: ({ signal }) => getChildSessions(activeParentId!, signal),
    enabled: Boolean(activeParentId),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const out: Row[] = [];
    const pushSession = (session: SessionSummary, topIndex: number) => {
      out.push({ kind: 'parent', session, topIndex });
      if (session.child_count > 0 && session.id === activeParentId) {
        if (activeChildrenQuery.isLoading) {
          out.push({ kind: 'child-loading', parentId: session.id, topIndex });
        } else {
          (activeChildrenQuery.data?.items ?? []).forEach((child) => {
            out.push({ kind: 'child', session: child, parentId: session.id, topIndex });
          });
        }
      }
    };

    // Pinned sessions always sort first (regardless of activity date) — group them under
    // their own header instead of folding them into the date buckets below, where they'd
    // make the date headers appear out of chronological order.
    let sawPinnedHeader = false;
    let lastDateLabel: string | null = null;
    sessions.forEach((session, topIndex) => {
      if (session.pinned) {
        if (!sawPinnedHeader) {
          out.push({ kind: 'group-header', label: 'Pinned', topIndex });
          sawPinnedHeader = true;
        }
      } else {
        const lastActivity = session.last_activity_at ?? session.started_at;
        const label = formatGroupDate(lastActivity, now);
        if (label !== lastDateLabel) {
          out.push({ kind: 'group-header', label, topIndex });
          lastDateLabel = label;
        }
      }
      pushSession(session, topIndex);
    });
    if (hasNextPage) out.push({ kind: 'loader', topIndex: sessions.length });
    return out;
  }, [sessions, activeParentId, activeChildrenQuery.isLoading, activeChildrenQuery.data, hasNextPage, now]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // TanStack Virtual returns unstable functions by design; the React Compiler lint knows this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const kind = rows[index]?.kind;
      if (kind === 'child') return SESSION_CHILD_ROW_HEIGHT;
      if (kind === 'group-header') return SESSION_GROUP_HEADER_HEIGHT;
      return SESSION_ROW_HEIGHT;
    },
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
      <Stack gap={8} p="md" style={{ borderBottom: '1px solid var(--astra-divider)' }}>
        <Group gap={8} wrap="nowrap">
          <MultiSelect
            aria-label="Filter by conversation type"
            placeholder="All types"
            data={SOURCE_OPTIONS}
            value={sources}
            onChange={setSources}
            clearable
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button leftSection={<IconPlus size={14} />} loading={create.isPending} onClick={() => create.mutate()}>
            New chat
          </Button>
        </Group>
        {showArchived ? (
          <UnstyledButton className={classes.archivedToggle} onClick={() => setShowArchived(false)}>
            <IconArrowLeft size={12} aria-hidden />
            Back to active
          </UnstyledButton>
        ) : (
          archivedCount > 0 && (
            <UnstyledButton className={classes.archivedToggle} onClick={() => setShowArchived(true)}>
              <IconArchive size={12} aria-hidden />
              Show {formatCount(archivedCount)} archived
            </UnstyledButton>
          )
        )}
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
                  {!row ? null : row.kind === 'group-header' ? (
                    <div className={classes.groupHeader}>{row.label}</div>
                  ) : row.kind === 'parent' ? (
                    <SessionRow session={row.session} active={row.session.id === selectedId} now={now} />
                  ) : row.kind === 'child' ? (
                    <SessionChildRow session={row.session} active={row.session.id === selectedId} />
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

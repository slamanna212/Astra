import {
  Badge,
  Button,
  Center,
  Chip,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconMessage, IconPinFilled, IconPlus } from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { createSession, listSessions, SESSION_PAGE_SIZE } from '../../api/sessions';
import type { SessionSummary } from '../../api/types';
import { SourceBadge } from '../../components/SourceBadge';
import { KNOWN_SOURCES } from '../../lib/sources';
import { useNow } from '../../hooks/useNow';
import { formatCount, formatDateTime, formatRelativeTime, sessionTitle } from '../../lib/format';
import classes from './SessionList.module.css';

export const SESSION_ROW_HEIGHT = 64;
/** Start fetching the next page when the last rendered row is within this many rows of the end. */
const LOAD_MORE_THRESHOLD = 10;

const SOURCE_OPTIONS = [{ value: '', label: 'All sources' }, ...KNOWN_SOURCES.map((s) => ({ value: s, label: s }))];

interface SessionRowProps {
  session: SessionSummary;
  active: boolean;
  now: number;
}

const SessionRow = memo(function SessionRow({ session, active, now }: SessionRowProps) {
  const lastActivity = session.last_activity_at ?? session.started_at;
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
          <IconPinFilled size={14} aria-label="Pinned" style={{ flexShrink: 0 }} color="var(--mantine-color-yellow-6)" />
        )}
        <Text size="sm" fw={500} truncate="end" style={{ flex: 1, minWidth: 0 }}>
          {sessionTitle(session)}
        </Text>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }} title={formatDateTime(lastActivity)}>
          {formatRelativeTime(lastActivity, now)}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        <SourceBadge source={session.source} />
        {session.archived && (
          <Badge size="xs" variant="outline" color="gray" radius="sm">
            archived
          </Badge>
        )}
        {session.hidden && (
          <Badge size="xs" variant="outline" color="gray" radius="sm">
            hidden
          </Badge>
        )}
        <Group gap={3} wrap="nowrap" ml="auto" c="dimmed">
          <IconMessage size={12} aria-hidden />
          <Text size="xs" c="dimmed" aria-label={`${session.message_count} messages`}>
            {formatCount(session.message_count)}
          </Text>
        </Group>
      </Group>
    </UnstyledButton>
  );
});

export function SessionList({ selectedId }: { selectedId?: string }) {
  const [source, setSource] = useState<string>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
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

  const filters = useMemo(
    () => ({ source: source || null, include_archived: includeArchived, include_hidden: includeHidden }),
    [source, includeArchived, includeHidden],
  );

  const query = useInfiniteQuery({
    queryKey: queryKeys.sessions.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listSessions({ ...filters, cursor: pageParam, limit: SESSION_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sessions = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowCount = sessions.length + (hasNextPage ? 1 : 0);

  // TanStack Virtual returns unstable functions by design; the React Compiler lint knows this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SESSION_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => sessions[index]?.id ?? `loader-${index}`,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1]!.index : -1;

  useEffect(() => {
    if (lastIndex < 0 || !hasNextPage || isFetchingNextPage) return;
    if (lastIndex >= sessions.length - LOAD_MORE_THRESHOLD) {
      void fetchNextPage();
    }
  }, [lastIndex, sessions.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Reset scroll when filters change so we don't sit past the end of a shorter list.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filters]);

  return (
    <>
      <Stack gap={8} p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          New chat
        </Button>
        <Select
          size="xs"
          aria-label="Filter by source"
          data={SOURCE_OPTIONS}
          value={source}
          onChange={(value) => setSource(value ?? '')}
          allowDeselect={false}
          checkIconPosition="right"
        />
        <Group gap={6}>
          <Chip size="xs" checked={includeArchived} onChange={setIncludeArchived}>
            Show archived
          </Chip>
          <Chip size="xs" checked={includeHidden} onChange={setIncludeHidden}>
            Show hidden
          </Chip>
        </Group>
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
              const session = sessions[item.index];
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
                  {session ? (
                    <SessionRow session={session} active={session.id === selectedId} now={now} />
                  ) : (
                    <Center h="100%">
                      {query.isFetchNextPageError ? (
                        <Button size="xs" variant="subtle" onClick={() => void fetchNextPage()}>
                          Retry loading more
                        </Button>
                      ) : (
                        <Loader size="xs" aria-label="Loading more sessions" />
                      )}
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

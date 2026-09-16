import { ActionIcon, Group, Loader, Select, Stack, Switch, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDownload, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getLogTail, logStreamUrl } from '../../api/logs';
import { queryKeys } from '../../api/queryKeys';
import { LOG_FILES, type LogEntry, type LogFile } from '../../api/types';
import { guessLevel, LOG_LEVELS, levelColor } from '../../lib/logs';
import classes from './LogsPage.module.css';

const LINE_COUNT_OPTIONS = ['100', '200', '500', '1000', '2000', '5000'];
const DEFAULT_LINES = 200;
const MAX_ACCUMULATED = 5000;

function LogLine({ entry, index, measureRef }: { entry: LogEntry; index: number; measureRef: (el: HTMLDivElement | null) => void }) {
  const level = entry.level ?? guessLevel(entry.raw);
  const color = levelColor(level);
  const title = entry.timestamp ? `${entry.timestamp}${entry.logger ? ` · ${entry.logger}` : ''}` : undefined;
  return (
    <div
      ref={measureRef}
      data-index={index}
      className={classes.line}
      style={{ borderLeftColor: `var(--mantine-color-${color}-6)` }}
      title={title}
    >
      {entry.raw}
    </div>
  );
}

function LineList({ lines }: { lines: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchor = useRef(true);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 15,
  });

  // Auto-scroll to the bottom as new lines arrive, but only while the viewer is already at (or
  // near) the bottom — mirrors the chat transcript's "follow unless the user scrolled up" rule.
  useEffect(() => {
    if (bottomAnchor.current) {
      virtualizer.scrollToIndex(Math.max(0, lines.length - 1), { align: 'end' });
    }
  }, [lines.length, virtualizer]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    bottomAnchor.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  if (lines.length === 0) {
    return (
      <div className={classes.scroller}>
        <Text size="sm" c="dimmed" p="md">
          No matching lines.
        </Text>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={classes.scroller} onScroll={handleScroll} data-testid="log-scroller">
      <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
          >
            <LogLine
              entry={lines[item.index]!}
              index={item.index}
              measureRef={(el) => {
                if (el) virtualizer.measureElement(el);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface StreamState {
  key: string;
  lines: LogEntry[];
  connected: boolean;
}

function initialStreamState(key: string): StreamState {
  return { key, lines: [], connected: false };
}

/** Manages an SSE connection to `/api/logs/stream`, accumulating lines client-side (capped). */
function useLogStream(file: LogFile, level: string | null, search: string, enabled: boolean) {
  const key = `${file}\0${level ?? ''}\0${search}`;
  const [state, setState] = useState<StreamState>(() => initialStreamState(key));

  // Reset synchronously during render when the stream's identity changes — the React-docs
  // "adjusting state when a prop changes" pattern — rather than in an effect, so this never
  // reads as an effect whose only job is calling setState (see effect below, which only ever
  // sets state from an event-listener callback, the legitimate case).
  const state_ = state.key === key ? state : initialStreamState(key);
  if (state_ !== state) setState(state_);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(logStreamUrl({ file, level, search }));

    source.addEventListener('open', () => setState((s) => (s.key === key ? { ...s, connected: true } : s)));
    source.addEventListener('line', (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent<string>).data) as LogEntry;
        setState((s) => {
          if (s.key !== key) return s;
          const next = [...s.lines, entry];
          return { ...s, lines: next.length > MAX_ACCUMULATED ? next.slice(next.length - MAX_ACCUMULATED) : next };
        });
      } catch {
        // Ignore a malformed event rather than tearing down the stream.
      }
    });
    source.addEventListener('rotated', () => setState((s) => (s.key === key ? { ...s, lines: [] } : s)));
    source.addEventListener('error', () => setState((s) => (s.key === key ? { ...s, connected: false } : s)));

    return () => {
      source.close();
      setState((s) => (s.key === key ? { ...s, connected: false } : s));
    };
  }, [key, file, level, search, enabled]);

  return { lines: state_.lines, connected: state_.connected };
}

export default function LogsPage() {
  const [file, setFile] = useState<LogFile>('agent.log');
  const [level, setLevel] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search] = useDebouncedValue(searchInput, 300);
  const [lines, setLines] = useState(DEFAULT_LINES);
  const [follow, setFollow] = useState(false);

  const tailQuery = useQuery({
    queryKey: queryKeys.logs.tail(file, { lines, level, search: search || null }),
    queryFn: ({ signal }) => getLogTail({ file, lines, level, search: search || null }, signal),
    enabled: !follow,
  });

  const stream = useLogStream(file, level, search, follow);

  const tailLines = tailQuery.data?.lines;
  const entries = useMemo(() => (follow ? stream.lines : (tailLines ?? [])), [follow, stream.lines, tailLines]);
  const visibleText = useMemo(() => entries.map((e) => e.raw).join('\n'), [entries]);

  const copyVisible = async () => {
    try {
      await navigator.clipboard.writeText(visibleText);
      notifications.show({ color: 'green', message: 'Copied the visible window to the clipboard' });
    } catch {
      notifications.show({ color: 'red', message: 'Could not access the clipboard' });
    }
  };

  const downloadVisible = () => {
    const blob = new Blob([visibleText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={classes.root}>
      <Tabs value={file} onChange={(value) => value && setFile(value as LogFile)}>
        <Tabs.List px="md" pt="sm">
          {LOG_FILES.map((f) => (
            <Tabs.Tab key={f} value={f}>
              {f}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group className={classes.toolbar} wrap="wrap">
        <TextInput
          className={classes.search}
          placeholder="Search…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          size="xs"
          aria-label="Search log lines"
        />
        <Select
          size="xs"
          w={130}
          aria-label="Filter by level"
          placeholder="All levels"
          clearable
          data={LOG_LEVELS.map((l) => ({ value: l, label: l }))}
          value={level}
          onChange={setLevel}
        />
        <Select
          size="xs"
          w={90}
          aria-label="Line count"
          data={LINE_COUNT_OPTIONS}
          value={String(lines)}
          onChange={(value) => value && setLines(Number(value))}
          disabled={follow}
          allowDeselect={false}
        />
        <Switch
          size="sm"
          label="Follow"
          checked={follow}
          onChange={(e) => setFollow(e.currentTarget.checked)}
          aria-label="Auto-follow new lines"
        />
        {!follow && (
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="md"
              aria-label="Refresh"
              onClick={() => void tailQuery.refetch()}
              loading={tailQuery.isFetching}
            >
              <IconRefresh size={16} stroke={1.5} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Copy visible window">
          <ActionIcon variant="subtle" size="md" aria-label="Copy visible window" onClick={() => void copyVisible()}>
            <IconCopy size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Download visible window">
          <ActionIcon variant="subtle" size="md" aria-label="Download visible window" onClick={downloadVisible}>
            <IconDownload size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        {follow && (
          <Text size="xs" c={stream.connected ? 'green' : 'dimmed'}>
            {stream.connected ? 'Live' : 'Connecting…'}
          </Text>
        )}
      </Group>

      {follow ? (
        <LineList lines={entries} />
      ) : tailQuery.isPending ? (
        <Stack align="center" p="xl">
          <Loader size="sm" aria-label="Loading logs" />
        </Stack>
      ) : tailQuery.isError ? (
        <Stack align="center" p="xl" gap="xs">
          <Text size="sm" c="red">
            {tailQuery.error instanceof Error ? tailQuery.error.message : 'Failed to load this log.'}
          </Text>
        </Stack>
      ) : (
        <>
          <LineList lines={entries} />
          {tailQuery.data?.truncated && (
            <Text size="xs" c="dimmed" px="md" py={4}>
              Showing the last {entries.length} lines of a larger file.
            </Text>
          )}
        </>
      )}
    </div>
  );
}

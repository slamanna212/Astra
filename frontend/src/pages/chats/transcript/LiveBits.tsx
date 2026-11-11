import { Badge, Box, Collapse, Group, Loader, Text, UnstyledButton } from '@mantine/core';
import { IconBulb, IconChevronRight } from '@tabler/icons-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useRememberedDisclosure } from '../../../lib/disclosureMemory';
import { useNow } from '../../../hooks/useNow';
import type { LiveStatus } from '../../../lib/liveTurn';
import classes from './Transcript.module.css';

/**
 * Reasoning that is streaming right now: a collapsed card like any other step, because it usually
 * scrolls by too fast to read. Opening it shows the live text, pinned to the newest line; the open
 * state carries over to the saved "Thought" card the reasoning becomes.
 */
export function ThinkingBlock({ text, thoughtKey }: { text: string; thoughtKey: string }) {
  const [open, toggle] = useRememberedDisclosure(`thought:${thoughtKey}`, false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, open]);
  return (
    <Box className={classes.toolRow} data-opened={open || undefined} data-status="running" data-kind="thinking">
      <UnstyledButton
        className={classes.toolHeader}
        aria-expanded={open}
        aria-label="Thinking"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <span className={classes.toolIcon}><IconBulb size={15} stroke={1.8} /></span>
        <Text component="span" className={`${classes.toolTitle} ${classes.shimmer}`}>Thinking</Text>
        <span className={classes.toolMeta}>
          <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
        </span>
      </UnstyledButton>
      <Collapse expanded={open}>
        {open && (
          <div
            ref={bodyRef}
            className={`${classes.thoughtBody} ${classes.thinkingLive}`}
            onScroll={(event) => {
              const el = event.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {text}
          </div>
        )}
      </Collapse>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** What the turn is doing now, with how long it has been going. */
export function LiveStatusLine({ status, startedAt }: { status: LiveStatus; startedAt?: number }) {
  const [mountedAt] = useState(() => Date.now());
  const now = useNow(1000);
  if (status.tone === 'error') {
    return (
      <Group gap={6} role="status">
        <Badge size="sm" variant="light" color="red" radius="sm">{status.label}</Badge>
      </Group>
    );
  }
  return (
    <Group gap={8} className={classes.liveStatus} wrap="nowrap">
      <Loader type="dots" size="xs" />
      <Text component="span" size="xs" c="dimmed" role="status" aria-live="polite">{status.label}</Text>
      <Text component="span" size="xs" c="dimmed" ff="monospace" aria-hidden>
        {formatElapsed(now - (startedAt ?? mountedAt))}
      </Text>
    </Group>
  );
}

import { Badge, Box, Collapse, Group, Loader, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight, IconSparkles } from '@tabler/icons-react';
import { useState } from 'react';
import { useNow } from '../../../hooks/useNow';
import type { LiveStatus } from '../../../lib/liveTurn';
import classes from './Transcript.module.css';

const PREVIEW_CHARS = 600;

/**
 * Reasoning that is streaming right now. The newest lines show through a faded window so the
 * reader can see the model is working; the full text is one click away.
 */
export function ThinkingBlock({ text }: { text: string }) {
  const [open, { toggle }] = useDisclosure(false);
  const tail = text.length > PREVIEW_CHARS ? `…${text.slice(-PREVIEW_CHARS)}` : text;
  return (
    <Box className={classes.thinking} data-opened={open || undefined}>
      <UnstyledButton
        className={classes.thinkingHeader}
        aria-expanded={open}
        aria-label="Thinking"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <IconSparkles size={14} className={classes.thinkingIcon} />
        <Text component="span" size="sm" fw={500} className={classes.shimmer}>Thinking</Text>
        <IconChevronRight size={13} className={classes.chevron} data-opened={open || undefined} />
      </UnstyledButton>
      {!open && <div className={classes.thinkingPreview} aria-hidden>{tail}</div>}
      <Collapse expanded={open}>
        {open && <Text size="sm" className={classes.thoughtBody}>{text}</Text>}
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

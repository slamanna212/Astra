import { Badge, Box, Button, Code, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { LiveActivityEvent } from '../../../lib/liveActivity';
import { deriveLivePhase, isWorkspaceActivity, type LiveTurn } from '../../../lib/liveTurn';
import classes from './Transcript.module.css';

const MAX_REASONING = 4000;

function activityLabel(event: LiveActivityEvent): string {
  const data = event.data ?? {};
  const candidate = [data.name, data.tool_name, data.tool, data.message, data.status]
    .find((value) => typeof value === 'string' && value.trim());
  return candidate ? String(candidate) : event.kind;
}

function activityDetail(event: LiveActivityEvent): string {
  if (event.text) return event.text;
  try {
    return JSON.stringify(event.data ?? {}, null, 2);
  } catch {
    return String(event.data ?? '');
  }
}

function LiveActivityCard({ event }: { event: LiveActivityEvent }) {
  const [opened, setOpened] = useState(false);
  return (
    <Box className={classes.toolCard} mb={6}>
      <UnstyledButton onClick={() => setOpened((value) => !value)} className={classes.toolCardHeader}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <IconChevronRight
            size={12}
            color="var(--astra-text-dim)"
            style={{ transform: opened ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease', flexShrink: 0 }}
          />
          <Badge size="xs" variant="light" color={event.kind === 'subagent' ? 'violet' : 'blue'} style={{ flexShrink: 0 }}>
            {event.kind}
          </Badge>
          <Text component="span" className={classes.toolArgs} truncate="end" style={{ minWidth: 0 }}>
            {activityLabel(event)}
          </Text>
        </Group>
      </UnstyledButton>
      {opened && (
        <Box className={classes.toolCardBody}>
          <Code block className={classes.toolCode}>{activityDetail(event) || '(no details)'}</Code>
        </Box>
      )}
    </Box>
  );
}

export function LiveTurnRow({
  turn,
  onRetry,
}: {
  turn: LiveTurn;
  onRetry?: () => void;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const phase = deriveLivePhase(turn);
  const activities = turn.events.filter(isWorkspaceActivity);
  return (
    <Stack gap="sm" aria-label="Current turn">
      {turn.userText !== null && (
        <Group justify="flex-end">
          <Box className={classes.userBubble} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.userText}</Box>
        </Group>
      )}
      <Box className={classes.assistantContent} style={{ maxWidth: '100%' }}>
        <Group gap="xs" mb="xs">
          <Text size="sm" fw={600}>Assistant</Text>
          <Badge role="status" size="xs" variant="light">{phase}</Badge>
        </Group>
        {turn.reasoning && (
          <Box className={classes.liveDetails}>
            <button type="button" aria-expanded={reasoningOpen} onClick={() => setReasoningOpen(!reasoningOpen)}>Thinking</button>
            {reasoningOpen && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>
                {turn.reasoning.slice(-MAX_REASONING)}{turn.reasoning.length > MAX_REASONING && '…'}
              </Text>
            )}
          </Box>
        )}
        {activities.length > 0 && (
          <Stack gap={0} mt="xs" aria-label="Current turn activity">
            {activities.map((event, index) => <LiveActivityCard key={`${event.kind}-${index}`} event={event} />)}
          </Stack>
        )}
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {turn.answer || (turn.state === 'failed' ? 'Response could not be completed.' : turn.reasoning ? 'Thinking…' : 'Waiting for response…')}
        </Text>
        {turn.state === 'unreconciled' && onRetry && (
          <Group gap="xs" mt="xs">
            <Text size="xs" c="dimmed">This response is shown from the live stream and is not confirmed in saved history.</Text>
            <Button size="compact-xs" variant="light" onClick={onRetry}>Retry history refresh</Button>
          </Group>
        )}
      </Box>
    </Stack>
  );
}

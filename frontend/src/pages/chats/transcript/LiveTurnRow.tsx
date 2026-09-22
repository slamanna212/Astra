import { Badge, Box, Drawer, Group, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { LiveActivityEvent } from '../../../lib/liveActivity';
import { deriveLivePhase, type LiveTurn } from '../../../lib/liveTurn';
import classes from './Transcript.module.css';

const MAX_REASONING = 4000;

function eventLabel(event: LiveActivityEvent): string {
  const data = event.data ?? {};
  const candidate = [data.name, data.tool_name, data.tool, data.message, data.status]
    .find((value) => typeof value === 'string' && value.trim());
  return candidate ? String(candidate) : event.kind;
}

function WorkspaceEvent({ event }: { event: LiveActivityEvent }) {
  const [open, setOpen] = useState(false);
  const data = event.data ?? {};
  return (
    <Paper withBorder p="xs">
      <Text size="xs" fw={600}>{event.kind}: {eventLabel(event)}</Text>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Event details</button>
      {open && (
        <Text component="pre" size="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>
          {JSON.stringify(data, null, 2)}
        </Text>
      )}
    </Paper>
  );
}

export function LiveTurnRow({ turn }: { turn: LiveTurn }) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const activities = turn.events.filter((event) => event.kind === 'tool' || event.kind === 'subagent' || event.kind === 'status');
  const phase = deriveLivePhase(turn);
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
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {turn.answer || (turn.state === 'failed' ? 'Response could not be completed.' : turn.reasoning ? 'Thinking…' : 'Waiting for response…')}
        </Text>
        <button
          className={classes.workspaceTrigger}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setWorkspaceOpen(true)}
        >
          Agent workspace{activities.length > 0 ? ` · ${activities.length} recent event${activities.length === 1 ? '' : 's'}` : ''}
        </button>
        <Drawer
          opened={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          title="Agent workspace"
          position="right"
          size="min(420px, 100%)"
          aria-label="Agent workspace"
          keepMounted={false}
        >
          <Text size="xs" c="dimmed">
            Recent live activity in arrival order. Earlier events may have rolled off; this is not a durable audit log.
          </Text>
          {activities.length === 0
            ? <Text size="sm" mt="xs" c="dimmed">No agent activity yet.</Text>
            : (
              <Stack gap="xs" mt="xs" aria-label="Agent workspace timeline">
                {activities.map((event, index) => <WorkspaceEvent key={index} event={event} />)}
              </Stack>
            )}
        </Drawer>
      </Box>
    </Stack>
  );
}

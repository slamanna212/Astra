import { Badge, Box, Button, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { deriveLivePhase, isWorkspaceActivity, type LiveTurn } from '../../../lib/liveTurn';
import classes from './Transcript.module.css';

const MAX_REASONING = 4000;

export function LiveTurnRow({
  turn,
  workspaceOpen,
  onOpenWorkspace,
  onRetry,
}: {
  turn: LiveTurn;
  workspaceOpen: boolean;
  onOpenWorkspace: () => void;
  onRetry?: () => void;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const phase = deriveLivePhase(turn);
  const activityCount = turn.events.filter(isWorkspaceActivity).length;
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
        {turn.state === 'unreconciled' && onRetry && (
          <Group gap="xs" mt="xs">
            <Text size="xs" c="dimmed">This response is shown from the live stream and is not confirmed in saved history.</Text>
            <Button size="compact-xs" variant="light" onClick={onRetry}>Retry history refresh</Button>
          </Group>
        )}
        <button
          className={classes.workspaceTrigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={workspaceOpen}
          onClick={onOpenWorkspace}
        >
          Agent workspace{activityCount > 0 ? ` · ${activityCount} recent event${activityCount === 1 ? '' : 's'}` : ''}
        </button>
      </Box>
    </Stack>
  );
}

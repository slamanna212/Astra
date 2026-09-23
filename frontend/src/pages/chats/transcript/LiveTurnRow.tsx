import { Badge, Box, Button, Code, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { LiveActivityEvent } from '../../../lib/liveActivity';
import { deriveLivePhase, groupLiveActivity, isWorkspaceActivity, type LiveToolItem, type LiveTurn } from '../../../lib/liveTurn';
import { formatToolArguments, toolArgumentPreview } from '../../../lib/toolDisplay';
import { ToolCard, ToolSection } from './ToolCard';
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
  return (
    <ToolCard name={activityLabel(event)} kind={event.kind} preview="">
      <Code block className={classes.toolCode}>{activityDetail(event) || '(no details)'}</Code>
    </ToolCard>
  );
}

function LiveToolCard({ item }: { item: LiveToolItem }) {
  const args = formatToolArguments(item.arguments);
  return (
    <ToolCard
      name={item.name}
      preview={item.preview || toolArgumentPreview(item.arguments)}
      status={item.status}
      duration={item.duration}
      warning={item.risk ? 'Hermes flagged this tool output as potentially risky' : null}
    >
      {args && <ToolSection label="Arguments">{args}</ToolSection>}
      <ToolSection label="Result">
        {item.result ?? <Text size="xs" c="dimmed">{item.status === 'running' ? 'Running…' : '(no output)'}</Text>}
      </ToolSection>
    </ToolCard>
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
  const activities = groupLiveActivity(turn.events.filter(isWorkspaceActivity));
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
          <Stack gap={6} mt="xs" mb="xs" align="flex-start" aria-label="Current turn activity">
            {activities.map((item, index) => (item.type === 'tool'
              ? <LiveToolCard key={`tool-${index}`} item={item} />
              : <LiveActivityCard key={`${item.event.kind}-${index}`} event={item.event} />))}
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

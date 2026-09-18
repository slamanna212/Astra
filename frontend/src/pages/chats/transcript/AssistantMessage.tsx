import { Box, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import { BrandMark } from '../../../components/BrandMark';
import { Markdown } from '../../../components/Markdown';
import type { ChildSession, Message } from '../../../api/types';
import type { ReasoningEffort } from '../../../api/chat';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';
import classes from './Transcript.module.css';
import { ContentParts } from './ContentParts';
import { MessageActions } from './MessageActions';
import type { ActivityDisplayMode } from '../../../lib/uiPreferences';

export function AssistantMessage({
  message,
  sessionId,
  toolResults,
  childSessions,
  highlighted,
  running,
  model,
  provider,
  reasoningEffort,
  sessionTokens,
  sessionCostUsd,
  activityDisplayMode,
}: {
  sessionId: string;
  message: Message;
  toolResults: Map<string, Message>;
  childSessions: ChildSession[];
  highlighted: boolean;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  sessionTokens?: number;
  sessionCostUsd?: number | null;
  activityDisplayMode: ActivityDisplayMode;
}) {
  const [revealed, setRevealed] = useState(false);
  const text = typeof message.content === 'string' ? message.content : null;
  const parts = Array.isArray(message.content) ? message.content : null;
  const [worklogOpen, { toggle: toggleWorklog }] = useDisclosure(false);
  const toolCards = message.tool_calls?.map((call) => (
    <ToolCallCard
      key={call.id || `${message.id}`}
      call={call}
      result={call.id ? toolResults.get(call.id) : undefined}
      callTimestamp={message.timestamp}
      childSessions={childSessions}
    />
  ));

  return (
    <Group
      align="flex-start"
      gap="xs"
      wrap="nowrap"
      className={`${classes.messageInteractive} ${highlighted ? classes.highlighted : ''}`}
      data-revealed={revealed || undefined}
      tabIndex={0}
      onClick={() => setRevealed((value) => !value)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setRevealed((value) => !value);
        }
      }}
    >
      <BrandMark size={24} />
      <Stack gap={8} className={classes.assistantContent}>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning} />}
        {activityDisplayMode === 'transparent_stream' && toolCards}
        {text && <Markdown codeHighlight sessionId={sessionId}>{text}</Markdown>}
        {parts && <ContentParts parts={parts} />}
        {activityDisplayMode === 'compact_worklog' && message.tool_calls && message.tool_calls.length > 0 && (
          <Box className={classes.toolCard} p={6}>
            <UnstyledButton onClick={(event) => { event.stopPropagation(); toggleWorklog(); }} style={{ width: '100%' }}>
              <Group gap={6} wrap="nowrap">
                <IconChevronRight size={12} style={{ transform: worklogOpen ? 'rotate(90deg)' : undefined }} />
                <Text size="xs" fw={600}>Worklog</Text>
                <Text size="xs" c="dimmed">{message.tool_calls.length} tool call{message.tool_calls.length === 1 ? '' : 's'}</Text>
              </Group>
            </UnstyledButton>
            <Collapse expanded={worklogOpen}>
              <Stack gap={6} mt={6}>{toolCards}</Stack>
            </Collapse>
          </Box>
        )}
        <MessageActions sessionId={sessionId} message={message} running={running} model={model} provider={provider} reasoningEffort={reasoningEffort} align="left" sessionTokens={sessionTokens} sessionCostUsd={sessionCostUsd} />
      </Stack>
    </Group>
  );
}

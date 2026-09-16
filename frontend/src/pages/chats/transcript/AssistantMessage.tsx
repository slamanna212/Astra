import { Avatar, Group, Paper, Stack, Text } from '@mantine/core';
import { IconRobot } from '@tabler/icons-react';
import { Markdown } from '../../../components/Markdown';
import type { ChildSession, Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';
import classes from './Transcript.module.css';

export function AssistantMessage({
  message,
  toolResults,
  childSessions,
  highlighted,
}: {
  message: Message;
  toolResults: Map<string, Message>;
  childSessions: ChildSession[];
  highlighted: boolean;
}) {
  const text = typeof message.content === 'string' ? message.content : null;
  const parts = Array.isArray(message.content) ? message.content : null;

  return (
    <Group align="flex-start" gap="xs" wrap="nowrap" className={highlighted ? classes.highlighted : undefined}>
      <Avatar color="grape" radius="xl" size="sm">
        <IconRobot size={16} />
      </Avatar>
      <Paper withBorder p="sm" radius="md" className={classes.bubble}>
        <Stack gap={4}>
          {message.reasoning && <ReasoningBlock reasoning={message.reasoning} />}
          {text && <Markdown codeHighlight>{text}</Markdown>}
          {parts && (
            <Text size="xs" c="dimmed">
              {parts.length} content part{parts.length === 1 ? '' : 's'} (unsupported preview)
            </Text>
          )}
          {message.tool_calls?.map((call) => (
            <ToolCallCard
              key={call.id || `${message.id}`}
              call={call}
              result={call.id ? toolResults.get(call.id) : undefined}
              callTimestamp={message.timestamp}
              childSessions={childSessions}
            />
          ))}
          <Text size="xs" c="dimmed">
            {formatDateTime(message.timestamp)}
            {message.truncated && ' · truncated'}
            {message.compacted && ' · from compaction summary'}
          </Text>
        </Stack>
      </Paper>
    </Group>
  );
}

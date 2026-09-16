import { Group, Stack, Text } from '@mantine/core';
import { BrandMark } from '../../../components/BrandMark';
import { Markdown } from '../../../components/Markdown';
import type { ChildSession, Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';
import classes from './Transcript.module.css';
import { ContentParts } from './ContentParts';

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
      <BrandMark size={24} />
      <Stack gap={8} className={classes.assistantContent}>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning} />}
        {text && <Markdown codeHighlight>{text}</Markdown>}
        {parts && <ContentParts parts={parts} />}
        {message.tool_calls?.map((call) => (
          <ToolCallCard
            key={call.id || `${message.id}`}
            call={call}
            result={call.id ? toolResults.get(call.id) : undefined}
            callTimestamp={message.timestamp}
            childSessions={childSessions}
          />
        ))}
        <Text component="span" className={classes.timestamp}>
          {formatDateTime(message.timestamp)}
          {message.truncated && ' · truncated'}
          {message.compacted && ' · from compaction summary'}
        </Text>
      </Stack>
    </Group>
  );
}

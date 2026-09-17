import { Badge, Box, Code, Group, Text } from '@mantine/core';
import type { ChildSession, Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import { AssistantMessage } from './AssistantMessage';
import { DisplayKindNotice } from './DisplayKindNotice';
import classes from './Transcript.module.css';
import { UserMessage } from './UserMessage';

/** A `tool` row whose call never showed up in the loaded window (a window boundary split a call
 * from its result — rare, since Hermes writes them as adjacent rows, but possible at a page
 * edge). Rendered as a minimal standalone notice instead of silently dropped. */
function OrphanToolResult({ message }: { message: Message }) {
  const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return (
    <Box className={classes.toolCard} mb={6}>
      <Group gap={6} p={6}>
        <Text size="xs" fw={600}>
          {message.tool_name ?? 'tool'} result
        </Text>
        <Badge size="xs" variant="light" color="gray">
          orphaned
        </Badge>
      </Group>
      <Code block className={classes.toolCode}>
        {text.slice(0, 2000)}
      </Code>
    </Box>
  );
}

export function MessageRow({
  message,
  toolResults,
  consumedToolCallIds,
  childSessions,
  highlighted,
  sessionId,
  running,
  model,
  provider,
}: {
  message: Message;
  toolResults: Map<string, Message>;
  consumedToolCallIds: Set<string>;
  childSessions: ChildSession[];
  highlighted: boolean;
  sessionId: string;
  running: boolean;
  model?: string | null;
  provider?: string | null;
}) {
  if (message.display_kind) {
    return <DisplayKindNotice message={message} />;
  }
  if (message.role === 'tool') {
    if (message.tool_call_id && consumedToolCallIds.has(message.tool_call_id)) return null;
    return <OrphanToolResult message={message} />;
  }
  if (message.role === 'user') {
    return <UserMessage sessionId={sessionId} message={message} highlighted={highlighted} running={running} model={model} provider={provider} />;
  }
  if (message.role === 'assistant') {
    return (
      <AssistantMessage
        message={message}
        sessionId={sessionId}
        toolResults={toolResults}
        childSessions={childSessions}
        highlighted={highlighted}
        running={running}
        model={model}
        provider={provider}
      />
    );
  }
  if (message.role === 'session_meta') {
    return null;
  }
  // Unknown/future role: never drop it silently.
  return (
    <Box className={classes.toolCard} mb={6} p={6}>
      <Text size="xs" c="dimmed">
        [{message.role}] {formatDateTime(message.timestamp)}
      </Text>
      {typeof message.content === 'string' && message.content && (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Text>
      )}
    </Box>
  );
}

import { Box, Text } from '@mantine/core';
import { memo } from 'react';
import type { Message } from '../../../api/types';
import type { ReasoningEffort } from '../../../api/chat';
import { formatDateTime } from '../../../lib/format';
import { DisplayKindNotice } from './DisplayKindNotice';
import classes from './Transcript.module.css';
import { UserMessage } from './UserMessage';

export const MessageRow = memo(function MessageRow({
  message,
  highlighted,
  sessionId,
  running,
  model,
  provider,
  reasoningEffort,
  sessionTokens,
  sessionCostUsd,
}: {
  message: Message;
  highlighted: boolean;
  sessionId: string;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  sessionTokens?: number;
  sessionCostUsd?: number | null;
}) {
  if (message.display_kind) {
    return <DisplayKindNotice message={message} />;
  }
  if (message.role === 'user') {
    return <UserMessage sessionId={sessionId} message={message} highlighted={highlighted} running={running} model={model} provider={provider} reasoningEffort={reasoningEffort} sessionTokens={sessionTokens} sessionCostUsd={sessionCostUsd} />;
  }
  if (message.role === 'session_meta') {
    return null;
  }
  // Unknown/future role: never drop it silently.
  return (
    <Box className={classes.unknownRow} mb={6} p={6}>
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
});

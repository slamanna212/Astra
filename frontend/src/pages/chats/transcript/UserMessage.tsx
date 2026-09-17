import { Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { Message } from '../../../api/types';
import type { ReasoningEffort } from '../../../api/chat';
import classes from './Transcript.module.css';
import { ContentParts } from './ContentParts';
import { MessageActions } from './MessageActions';

/** User content is always plain text in real data (verified against exampledata/hermes-home) —
 * rendered as-is (whitespace preserved), not through the markdown pipeline. */
export function UserMessage({
  sessionId,
  message,
  highlighted,
  running,
  model,
  provider,
  reasoningEffort,
}: {
  sessionId: string;
  message: Message;
  highlighted: boolean;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const text = typeof message.content === 'string' ? message.content : null;
  const parts = Array.isArray(message.content) ? message.content : null;
  return (
    <Group
      justify="flex-end"
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
      <Stack gap={3} align="flex-end" className={classes.userMessage}>
        <Stack gap={4} className={classes.userBubble}>
          {text && (
            <Text
              style={{
                fontSize: 'var(--astra-chat-font-size, 14px)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                lineHeight: 1.55,
              }}
            >
              {text}
            </Text>
          )}
          {parts && <ContentParts parts={parts} />}
        </Stack>
        <MessageActions sessionId={sessionId} message={message} running={running} model={model} provider={provider} reasoningEffort={reasoningEffort} align="right" />
      </Stack>
    </Group>
  );
}

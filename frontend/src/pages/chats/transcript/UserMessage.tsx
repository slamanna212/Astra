import { Group, Stack, Text } from '@mantine/core';
import type { Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import classes from './Transcript.module.css';
import { ContentParts } from './ContentParts';

/** User content is always plain text in real data (verified against exampledata/hermes-home) —
 * rendered as-is (whitespace preserved), not through the markdown pipeline. */
export function UserMessage({ message, highlighted }: { message: Message; highlighted: boolean }) {
  const text = typeof message.content === 'string' ? message.content : null;
  const parts = Array.isArray(message.content) ? message.content : null;
  return (
    <Group justify="flex-end" className={highlighted ? classes.highlighted : undefined}>
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
        <Text component="span" className={classes.timestamp} style={{ color: 'inherit', opacity: 0.75 }}>
          {formatDateTime(message.timestamp)}
          {message.truncated && ' · truncated'}
        </Text>
      </Stack>
    </Group>
  );
}

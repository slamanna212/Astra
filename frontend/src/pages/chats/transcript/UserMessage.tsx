import { Avatar, Group, Paper, Stack, Text } from '@mantine/core';
import { IconUser } from '@tabler/icons-react';
import type { Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import classes from './Transcript.module.css';

/** User content is always plain text in real data (verified against exampledata/hermes-home) —
 * rendered as-is (whitespace preserved), not through the markdown pipeline. */
export function UserMessage({ message, highlighted }: { message: Message; highlighted: boolean }) {
  const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return (
    <Group align="flex-start" gap="xs" wrap="nowrap" className={highlighted ? classes.highlighted : undefined}>
      <Avatar color="blue" radius="xl" size="sm">
        <IconUser size={16} />
      </Avatar>
      <Paper withBorder p="sm" radius="md" className={classes.bubble}>
        <Stack gap={4}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {text}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDateTime(message.timestamp)}
            {message.truncated && ' · truncated'}
          </Text>
        </Stack>
      </Paper>
    </Group>
  );
}

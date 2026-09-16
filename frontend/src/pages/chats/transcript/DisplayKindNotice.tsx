import { Center, Text } from '@mantine/core';
import type { Message } from '../../../api/types';

/** Non-conversation rows Hermes preserves for id reconciliation (BUILD-SPEC §4.4/§4.6) — shown as
 * a subtle centered notice rather than a chat bubble. */
export function DisplayKindNotice({ message }: { message: Message }) {
  const text = typeof message.content === 'string' && message.content.trim() ? message.content : message.display_kind;
  return (
    <Center my={4}>
      <Text size="xs" c="dimmed" fs="italic" ta="center" maw={520}>
        {text}
      </Text>
    </Center>
  );
}

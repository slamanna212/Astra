import { Center, Stack, Text } from '@mantine/core';
import { IconMessages } from '@tabler/icons-react';

export default function ChatsIndex() {
  return (
    <Center h="100%">
      <Stack align="center" gap={4} c="dimmed">
        <IconMessages size={40} stroke={1.2} />
        <Text c="dimmed">Select a conversation</Text>
      </Stack>
    </Center>
  );
}

import { Center, Stack, Text } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';

export default function CronIndex() {
  return (
    <Center h="100%">
      <Stack align="center" gap={4} c="dimmed">
        <IconClock size={40} stroke={1.2} />
        <Text c="dimmed">Select a scheduled task</Text>
      </Stack>
    </Center>
  );
}

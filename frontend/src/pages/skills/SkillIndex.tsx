import { Center, Stack, Text } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';

export default function SkillIndex() {
  return (
    <Center h="100%">
      <Stack align="center" gap={4} c="dimmed">
        <IconSparkles size={40} stroke={1.2} />
        <Text c="dimmed">Select a skill</Text>
      </Stack>
    </Center>
  );
}

import { Box, Collapse, Group, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight, IconSparkles } from '@tabler/icons-react';
import classes from './Transcript.module.css';

export function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [opened, { toggle }] = useDisclosure(false);
  return (
    <Box mb={6}>
      <UnstyledButton onClick={toggle} className={classes.reasoningToggle}>
        <Group gap={6} wrap="nowrap">
          <IconChevronRight
            size={14}
            style={{ transform: opened ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
          />
          <IconSparkles size={14} />
          <Text size="xs" c="dimmed" fw={500}>
            Thinking
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Text size="xs" c="dimmed" className={classes.reasoningBody}>
          {reasoning}
        </Text>
      </Collapse>
    </Box>
  );
}

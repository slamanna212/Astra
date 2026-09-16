import { Anchor, Badge, Box, Code, Collapse, Group, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { ChildSession, Message, ToolCall } from '../../../api/types';
import { findDelegatedChildren } from '../../../lib/transcript';
import classes from './Transcript.module.css';

function summarizeArguments(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function resultText(result: Message | undefined): string | null {
  if (!result) return null;
  if (typeof result.content === 'string') return result.content;
  if (result.content == null) return null;
  try {
    return JSON.stringify(result.content, null, 2);
  } catch {
    return String(result.content);
  }
}

const RESULT_PREVIEW_CHARS = 2000;

export function ToolCallCard({
  call,
  result,
  callTimestamp,
  childSessions,
}: {
  call: ToolCall;
  result: Message | undefined;
  callTimestamp: number;
  childSessions: ChildSession[];
}) {
  const [opened, { toggle }] = useDisclosure(false);
  const summary = summarizeArguments(call.arguments);
  const full = resultText(result);
  const isLong = !!full && full.length > RESULT_PREVIEW_CHARS;
  const status = result ? 'done' : 'pending';
  const delegated = call.name === 'delegate_task' ? findDelegatedChildren(childSessions, callTimestamp) : [];

  return (
    <Box className={classes.toolCard} mb={6}>
      <UnstyledButton onClick={toggle} className={classes.toolCardHeader}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <IconChevronRight
            size={12}
            color="var(--astra-text-dim)"
            style={{ transform: opened ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease', flexShrink: 0 }}
          />
          <Text component="span" className={classes.toolName} style={{ flexShrink: 0 }}>
            {call.name ?? 'tool'}
          </Text>
          <Text component="span" className={classes.toolArgs} truncate="end" style={{ minWidth: 0 }}>
            {summary}
          </Text>
        </Group>
        <Badge size="xs" variant="light" color={status === 'done' ? 'green' : 'sand'} ml="auto" style={{ flexShrink: 0 }}>
          {status}
        </Badge>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Box className={classes.toolCardBody}>
          {call.arguments_truncated && (
            <Text size="xs" c="orange" mb={4}>
              Arguments truncated.
            </Text>
          )}
          <Text size="xs" c="dimmed" fw={600} mt={4}>
            Arguments
          </Text>
          <Code block className={classes.toolCode}>
            {summary || '(none)'}
          </Code>
          <Text size="xs" c="dimmed" fw={600} mt={8}>
            Result
          </Text>
          {full === null ? (
            <Text size="xs" c="dimmed">
              Waiting for result…
            </Text>
          ) : (
            <Code block className={classes.toolCode}>
              {isLong && !opened ? full.slice(0, RESULT_PREVIEW_CHARS) : full}
            </Code>
          )}
          {result?.truncated && (
            <Text size="xs" c="orange" mt={4}>
              Result truncated by the server; open the full message to see everything.
            </Text>
          )}
          {delegated.length > 0 && (
            <Group gap={6} mt={8}>
              <Text size="xs" c="dimmed">
                Spawned:
              </Text>
              {delegated.map((child) => (
                <Anchor
                  key={child.id}
                  component={Link}
                  to={`/chats/${encodeURIComponent(child.id)}`}
                  size="xs"
                >
                  {child.title || child.display_name || child.id}
                </Anchor>
              ))}
            </Group>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

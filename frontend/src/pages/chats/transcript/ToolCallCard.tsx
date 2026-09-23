import { Anchor, Group, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { ChildSession, Message, ToolCall } from '../../../api/types';
import { formatToolArguments, toolArgumentPreview } from '../../../lib/toolDisplay';
import { findDelegatedChildren } from '../../../lib/transcript';
import { ToolCard, ToolSection } from './ToolCard';

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

export function ToolCallCard({
  call,
  result,
  callTimestamp,
  childSessions,
  running = false,
}: {
  call: ToolCall;
  result: Message | undefined;
  callTimestamp: number;
  childSessions: ChildSession[];
  /** The session has a turn in flight, so a result-less call is still executing. */
  running?: boolean;
}) {
  const full = resultText(result);
  const delegated = call.name === 'delegate_task' ? findDelegatedChildren(childSessions, callTimestamp) : [];

  return (
    <ToolCard name={call.name} preview={toolArgumentPreview(call.arguments)} status={result ? 'done' : running ? 'running' : 'pending'}>
      {call.arguments_truncated && (
        <Text size="xs" c="sand" mt={8}>
          Arguments truncated.
        </Text>
      )}
      <ToolSection label="Arguments">{formatToolArguments(call.arguments) || '(none)'}</ToolSection>
      <ToolSection label="Result">
        {full === null ? <Text size="xs" c="dimmed">Waiting for result…</Text> : full}
      </ToolSection>
      {result?.truncated && (
        <Text size="xs" c="sand" mt={4}>
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
    </ToolCard>
  );
}

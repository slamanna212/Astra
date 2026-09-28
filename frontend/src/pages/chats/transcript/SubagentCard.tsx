import { Anchor, Badge, Group, Loader, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconExternalLink, IconRobot, IconX } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { ChildSession } from '../../../api/types';
import { sessionTitle } from '../../../lib/format';
import { formatToolDuration } from '../../../lib/toolDisplay';
import { findDelegatedChildren } from '../../../lib/transcript';
import type { SubagentItem, ToolItem } from '../../../lib/turnBlocks';
import classes from './Transcript.module.css';

function StatusIcon({ status }: { status: SubagentItem['status'] }) {
  if (status === 'running') return <Loader size={14} type="oval" aria-label="Running" />;
  return (
    <ThemeIcon size={18} radius="xl" variant="light" color={status === 'error' ? 'red' : 'green'} aria-label={status === 'error' ? 'Failed' : 'Done'}>
      {status === 'error' ? <IconX size={12} /> : <IconCheck size={12} />}
    </ThemeIcon>
  );
}

function ChildLink({ id }: { id: string }) {
  return (
    <Anchor
      component={Link}
      to={`/chats/${encodeURIComponent(id)}`}
      size="xs"
      onClick={(event) => event.stopPropagation()}
      className={classes.subagentLink}
    >
      Open chat <IconExternalLink size={11} />
    </Anchor>
  );
}

function LiveSubagent({ agent }: { agent: SubagentItem }) {
  const duration = formatToolDuration(agent.duration);
  return (
    <Paper withBorder radius="sm" p={8} className={classes.subagentCard} data-status={agent.status}>
      <Group gap={8} wrap="nowrap" align="flex-start">
        <StatusIcon status={agent.status} />
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={500} lineClamp={2}>{agent.goal}</Text>
          {agent.status === 'running' && agent.activity && (
            <Text size="xs" c="dimmed" ff="monospace" truncate="end">{agent.activity}</Text>
          )}
          {agent.status !== 'running' && agent.summary && (
            <Text size="xs" c="dimmed" lineClamp={3}>{agent.summary}</Text>
          )}
          <Group gap={8}>
            {agent.toolCount > 0 && (
              <Badge size="xs" variant="light" color="gray" radius="sm">
                {agent.toolCount} tool call{agent.toolCount === 1 ? '' : 's'}
              </Badge>
            )}
            {duration && <Text size="xs" c="dimmed" ff="monospace">{duration}</Text>}
            {agent.childSessionId && <ChildLink id={agent.childSessionId} />}
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}

function goalsFromArguments(args: unknown): string[] {
  let value = args;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [value as string];
    }
  }
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tasks)) {
    return record.tasks
      .map((task) => (task && typeof task === 'object' ? (task as Record<string, unknown>).goal : task))
      .filter((goal): goal is string => typeof goal === 'string' && goal.trim() !== '');
  }
  return typeof record.goal === 'string' ? [record.goal] : [];
}

/** Delegated work: one card per subagent with its live status and a link into its own chat. */
export function SubagentList({ item, childSessions }: { item: ToolItem; childSessions: ChildSession[] }) {
  if (item.subagents.length > 0) {
    return (
      <Stack gap={6}>
        {item.subagents.map((agent) => <LiveSubagent key={agent.id} agent={agent} />)}
      </Stack>
    );
  }
  const children = item.timestamp !== null ? findDelegatedChildren(childSessions, item.timestamp) : [];
  if (children.length > 0) {
    return (
      <Stack gap={6}>
        {children.map((child) => (
          <Paper key={child.id} withBorder radius="sm" p={8} className={classes.subagentCard}>
            <Group gap={8} wrap="nowrap">
              <ThemeIcon size={18} radius="xl" variant="light" color="gray"><IconRobot size={12} /></ThemeIcon>
              <Text size="sm" fw={500} truncate="end" style={{ flex: 1, minWidth: 0 }}>{sessionTitle(child)}</Text>
              {child.message_count !== null && <Text size="xs" c="dimmed">{child.message_count} msgs</Text>}
              <ChildLink id={child.id} />
            </Group>
          </Paper>
        ))}
      </Stack>
    );
  }
  const goals = goalsFromArguments(item.arguments);
  if (goals.length === 0) return null;
  return (
    <Stack gap={6}>
      {goals.map((goal, index) => (
        <Paper key={index} withBorder radius="sm" p={8} className={classes.subagentCard}>
          <Group gap={8} wrap="nowrap">
            <ThemeIcon size={18} radius="xl" variant="light" color="gray"><IconRobot size={12} /></ThemeIcon>
            <Text size="sm" lineClamp={2}>{goal}</Text>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

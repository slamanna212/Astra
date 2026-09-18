import { Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconGitBranch } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GitStatus } from '../../api/types';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describe(status: GitStatus): string[] {
  const lines: string[] = [];
  if (status.branch) lines.push(`On branch ${status.branch}`);
  else lines.push(`Detached HEAD${status.head ? ` at ${status.head}` : ''}`);
  if (status.upstream) {
    const sync =
      status.ahead || status.behind
        ? [status.ahead && `${status.ahead} ahead`, status.behind && `${status.behind} behind`].filter(Boolean).join(', ')
        : 'up to date';
    lines.push(`${status.upstream}: ${sync}`);
  }
  if (!status.dirty) {
    lines.push('Working tree clean');
  } else {
    if (status.conflicted) lines.push(plural(status.conflicted, 'conflicted file'));
    if (status.staged) lines.push(`${plural(status.staged, 'file')} staged`);
    if (status.unstaged) lines.push(`${plural(status.unstaged, 'file')} modified`);
    if (status.untracked) lines.push(`${plural(status.untracked, 'file')} untracked`);
  }
  return lines;
}

/**
 * Branch + dirty status of the repo the current Files directory is in. Renders nothing outside a
 * repo (or while the status is unavailable) — it is ambient context, not a primary control.
 */
export function GitBadge({ query }: { query: UseQueryResult<GitStatus> }) {
  const status = query.data;
  if (!status?.repo) return null;

  const changes = status.staged + status.unstaged + status.untracked + status.conflicted;
  const label = status.branch ?? status.head ?? 'detached';
  const color = status.conflicted ? 'red' : status.dirty ? 'sand' : 'gray';

  return (
    <Tooltip
      withArrow
      multiline
      label={
        <Stack gap={2}>
          {describe(status).map((line) => (
            <Text key={line} size="xs">
              {line}
            </Text>
          ))}
        </Stack>
      }
    >
      <Badge
        variant="light"
        color={color}
        radius="xl"
        size="sm"
        tt="none"
        leftSection={<IconGitBranch size={12} stroke={1.75} />}
        styles={{ root: { flexShrink: 1, minWidth: 0, maxWidth: '12rem' }, label: { fontFamily: 'var(--astra-font-mono)' } }}
        data-testid="git-badge"
        aria-label={`Git: ${describe(status).join('. ')}`}
      >
        <Group gap={4} wrap="nowrap">
          <Text span inherit truncate="end" style={{ minWidth: 0 }}>
            {status.branch ?? `@${label}`}
          </Text>
          {status.dirty && (
            <Text span inherit style={{ flexShrink: 0 }}>
              ● {changes}
            </Text>
          )}
          {status.ahead > 0 && (
            <Text span inherit style={{ flexShrink: 0 }}>
              ↑{status.ahead}
            </Text>
          )}
          {status.behind > 0 && (
            <Text span inherit style={{ flexShrink: 0 }}>
              ↓{status.behind}
            </Text>
          )}
        </Group>
      </Badge>
    </Tooltip>
  );
}

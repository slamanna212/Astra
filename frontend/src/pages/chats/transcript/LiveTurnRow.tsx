import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { useMemo, type ReactNode } from 'react';
import { deriveLiveStatus, type LiveTurn } from '../../../lib/liveTurn';
import { buildLiveBlocks, type ActivityBlock, type TurnBlock } from '../../../lib/turnBlocks';
import { AssistantFrame, BlockView, type BlockContext } from './AssistantBlockRow';
import { LiveStatusLine } from './LiveBits';
import classes from './Transcript.module.css';

/** Saved activity that the live turn continues, shown as one group with the live steps. */
function mergeLeading(blocks: TurnBlock[], leading: ActivityBlock | null): TurnBlock[] {
  if (!leading) return blocks;
  const first = blocks[0];
  if (first?.kind === 'activity') {
    return [{ ...leading, items: [...leading.items, ...first.items] }, ...blocks.slice(1)];
  }
  return [leading, ...blocks];
}

export function LiveTurnRow({
  turn,
  context,
  avatar = true,
  leading = null,
  prompts,
  onRetry,
}: {
  turn: LiveTurn;
  context: BlockContext;
  /** False when this turn continues saved blocks that already carry the avatar. */
  avatar?: boolean;
  /** The saved turn's trailing activity group, when the live steps extend it. */
  leading?: ActivityBlock | null;
  /** Questions or approvals Hermes is waiting on, answered in place. */
  prompts?: ReactNode;
  onRetry?: () => void;
}) {
  const liveBlocks = useMemo(() => buildLiveBlocks(turn), [turn]);
  const blocks = useMemo(() => mergeLeading(liveBlocks, leading), [liveBlocks, leading]);
  const status = prompts && turn.state === 'running'
    ? { label: 'Waiting for your answer', tone: 'active' as const }
    : deriveLiveStatus(turn, liveBlocks);
  const active = turn.state === 'running' || turn.state === 'sending' || turn.state === 'reconnecting';
  const lastIndex = blocks.length - 1;
  return (
    <Stack gap="sm" aria-label="Current turn">
      {turn.userText !== null && (
        <Group justify="flex-end">
          <Box className={classes.userBubble} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.userText}</Box>
        </Group>
      )}
      <AssistantFrame avatar={avatar}>
        <Stack gap={8} aria-label="Current turn activity">
          {blocks.map((block, index) => (
            <BlockView
              key={block.key}
              block={block}
              context={context}
              pendingIsRunning={active}
              streaming={active && index === lastIndex && block.kind === 'text'}
            />
          ))}
          {turn.state === 'failed' && blocks.length === 0 && (
            <Text size="sm" c="dimmed">Response could not be completed.</Text>
          )}
          {prompts}
          <LiveStatusLine status={status} startedAt={turn.startedAt} />
          {turn.state === 'unreconciled' && onRetry && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">This response is shown from the live stream and is not confirmed in saved history.</Text>
              <Button size="compact-xs" variant="light" onClick={onRetry}>Retry history refresh</Button>
            </Group>
          )}
        </Stack>
      </AssistantFrame>
    </Stack>
  );
}

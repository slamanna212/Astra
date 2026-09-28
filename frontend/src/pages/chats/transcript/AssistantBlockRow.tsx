import { Badge, Box, Group, Text } from '@mantine/core';
import { memo, useState, type ReactNode } from 'react';
import type { ReasoningEffort } from '../../../api/chat';
import type { ChildSession, Message } from '../../../api/types';
import { BrandMark } from '../../../components/BrandMark';
import { Markdown } from '../../../components/Markdown';
import type { ActivityDisplayMode } from '../../../lib/uiPreferences';
import type { BlockEntry, TurnBlock } from '../../../lib/turnBlocks';
import { ActivityGroup } from './ActivityGroup';
import { ContentParts } from './ContentParts';
import { ThinkingBlock } from './LiveBits';
import { MessageActions } from './MessageActions';
import classes from './Transcript.module.css';

export interface BlockContext {
  sessionId: string;
  childSessions: ChildSession[];
  activityDisplayMode: ActivityDisplayMode;
}

/** One block of an assistant turn, identical whether it came from the stream or saved history. */
export function BlockView({
  block,
  context,
  pendingIsRunning,
  streaming = false,
}: {
  block: TurnBlock;
  context: BlockContext;
  pendingIsRunning: boolean;
  /** The text block the model is still writing: show a cursor at its end. */
  streaming?: boolean;
}) {
  if (block.kind === 'text') {
    if (block.markdown) return <Markdown sessionId={context.sessionId}>{block.text}</Markdown>;
    return (
      <Text className={classes.liveText}>
        {block.text}
        {streaming && <span className={classes.cursor} aria-hidden />}
      </Text>
    );
  }
  if (block.kind === 'parts') return <ContentParts parts={block.parts} />;
  if (block.kind === 'thinking') return <ThinkingBlock text={block.text} />;
  return (
    <ActivityGroup
      block={block}
      pendingIsRunning={pendingIsRunning}
      childSessions={context.childSessions}
      defaultOpen={context.activityDisplayMode === 'transparent_stream'}
    />
  );
}

const ENDINGS: Record<string, { label: string; color: string }> = {
  length: { label: 'Cut off at the output limit', color: 'sand' },
  max_tokens: { label: 'Cut off at the output limit', color: 'sand' },
  content_filter: { label: 'Stopped by a content filter', color: 'red' },
  interrupted: { label: 'Stopped', color: 'gray' },
  cancelled: { label: 'Stopped', color: 'gray' },
  canceled: { label: 'Stopped', color: 'gray' },
  error: { label: 'Ended with an error', color: 'red' },
};

/** A turn that did not end normally says so where the reader's eye lands: at its end. */
export function TurnEnding({ finishReason }: { finishReason: string | null }) {
  const ending = finishReason ? ENDINGS[finishReason] : undefined;
  if (!ending) return null;
  return <Badge size="sm" variant="light" color={ending.color} radius="sm" className={classes.endChip}>{ending.label}</Badge>;
}

/** Avatar gutter + content column shared by saved blocks and the live turn. */
export function AssistantFrame({ avatar, children }: { avatar: boolean; children: ReactNode }) {
  return (
    <Group align="flex-start" gap={10} wrap="nowrap" className={classes.assistantFrame}>
      <Box className={classes.avatarGutter}>{avatar && <BrandMark size={24} />}</Box>
      <Box className={classes.assistantContent}>{children}</Box>
    </Group>
  );
}

export const AssistantBlockRow = memo(function AssistantBlockRow({
  entry,
  last,
  context,
  highlighted,
  running,
  model,
  provider,
  reasoningEffort,
  sessionTokens,
  sessionCostUsd,
}: {
  entry: BlockEntry;
  /** Overrides `entry.last` while a live turn continues this one. */
  last: boolean;
  context: BlockContext;
  highlighted: boolean;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  sessionTokens?: number;
  sessionCostUsd?: number | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const actionMessage: Message | null = last ? entry.actionMessage : null;
  return (
    <div
      className={`${classes.messageInteractive} ${highlighted ? classes.highlighted : ''}`}
      data-revealed={revealed || undefined}
      tabIndex={actionMessage ? 0 : undefined}
      onClick={actionMessage ? () => setRevealed((value) => !value) : undefined}
      onKeyDown={actionMessage ? (event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setRevealed((value) => !value);
        }
      } : undefined}
    >
      <AssistantFrame avatar={entry.first}>
        <BlockView block={entry.block} context={context} pendingIsRunning={running && entry.latestTurn} />
        {actionMessage && (
          <>
            <TurnEnding finishReason={actionMessage.finish_reason} />
            <MessageActions
              sessionId={context.sessionId}
              message={actionMessage}
              running={running}
              model={model}
              provider={provider}
              reasoningEffort={reasoningEffort}
              align="left"
              sessionTokens={sessionTokens}
              sessionCostUsd={sessionCostUsd}
            />
          </>
        )}
      </AssistantFrame>
    </div>
  );
});

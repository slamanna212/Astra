import { Group, Stack } from '@mantine/core';
import { useState } from 'react';
import { BrandMark } from '../../../components/BrandMark';
import { Markdown } from '../../../components/Markdown';
import type { ChildSession, Message } from '../../../api/types';
import type { ReasoningEffort } from '../../../api/chat';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';
import classes from './Transcript.module.css';
import { ContentParts } from './ContentParts';
import { MessageActions } from './MessageActions';

export function AssistantMessage({
  message,
  sessionId,
  toolResults,
  childSessions,
  highlighted,
  running,
  model,
  provider,
  reasoningEffort,
}: {
  sessionId: string;
  message: Message;
  toolResults: Map<string, Message>;
  childSessions: ChildSession[];
  highlighted: boolean;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  reasoningEffort?: ReasoningEffort | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const text = typeof message.content === 'string' ? message.content : null;
  const parts = Array.isArray(message.content) ? message.content : null;

  return (
    <Group
      align="flex-start"
      gap="xs"
      wrap="nowrap"
      className={`${classes.messageInteractive} ${highlighted ? classes.highlighted : ''}`}
      data-revealed={revealed || undefined}
      tabIndex={0}
      onClick={() => setRevealed((value) => !value)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setRevealed((value) => !value);
        }
      }}
    >
      <BrandMark size={24} />
      <Stack gap={8} className={classes.assistantContent}>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning} />}
        {text && <Markdown codeHighlight>{text}</Markdown>}
        {parts && <ContentParts parts={parts} />}
        {message.tool_calls?.map((call) => (
          <ToolCallCard
            key={call.id || `${message.id}`}
            call={call}
            result={call.id ? toolResults.get(call.id) : undefined}
            callTimestamp={message.timestamp}
            childSessions={childSessions}
          />
        ))}
        <MessageActions sessionId={sessionId} message={message} running={running} model={model} provider={provider} reasoningEffort={reasoningEffort} align="left" />
      </Stack>
    </Group>
  );
}

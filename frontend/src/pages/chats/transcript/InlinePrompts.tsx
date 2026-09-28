import { Button, Group, Paper, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { IconMessageQuestion, IconShieldExclamation } from '@tabler/icons-react';
import { useState } from 'react';
import { CodeBlock } from './ToolResultView';
import classes from './Transcript.module.css';

export interface ClarifyPrompt {
  id: number;
  question: string;
  choices: unknown[] | null;
}

export interface ApprovalPrompt {
  request_id: string;
  command?: string;
  description?: string;
}

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

const APPROVAL_LABELS: Record<ApprovalChoice, string> = {
  once: 'Approve once',
  session: 'Approve for session',
  always: 'Always approve',
  deny: 'Deny',
};

/** Hermes asked the reader a question mid-turn; answered in place, where the turn paused. */
export function ClarifyCard({ prompt, onAnswer }: { prompt: ClarifyPrompt; onAnswer: (answer: string) => Promise<unknown> | void }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const answer = (value: string) => {
    setSent(true);
    // A rejected answer leaves the question open so the reader can try again.
    Promise.resolve(onAnswer(value)).catch(() => setSent(false));
  };
  return (
    <Paper withBorder radius="md" p="sm" className={classes.promptCard} data-kind="clarify">
      <Stack gap="xs">
        <Group gap={8} wrap="nowrap" align="flex-start">
          <ThemeIcon size={24} radius="xl" variant="light" color="teal"><IconMessageQuestion size={14} /></ThemeIcon>
          <Text size="sm" fw={500} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prompt.question}</Text>
        </Group>
        {(prompt.choices ?? []).length > 0 && (
          <Group gap={6}>
            {(prompt.choices ?? []).map((choice) => (
              <Button key={String(choice)} size="xs" variant="light" disabled={sent} onClick={() => answer(String(choice))}>
                {String(choice)}
              </Button>
            ))}
          </Group>
        )}
        <Group gap={6} wrap="nowrap">
          <TextInput
            size="xs"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && text.trim() && !sent) answer(text.trim());
            }}
            placeholder={(prompt.choices ?? []).length > 0 ? 'Or type another answer' : 'Type your answer'}
            aria-label="Answer"
            disabled={sent}
            style={{ flex: 1 }}
          />
          <Button size="xs" disabled={!text.trim() || sent} onClick={() => answer(text.trim())}>Answer</Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/** A command needs the reader's permission before the turn can continue. */
export function ApprovalCard({ prompt, onChoose }: { prompt: ApprovalPrompt; onChoose: (choice: ApprovalChoice) => Promise<unknown> | void }) {
  const [sent, setSent] = useState(false);
  return (
    <Paper withBorder radius="md" p="sm" className={classes.promptCard} data-kind="approval">
      <Stack gap="xs">
        <Group gap={8} wrap="nowrap" align="flex-start">
          <ThemeIcon size={24} radius="xl" variant="light" color="sand"><IconShieldExclamation size={14} /></ThemeIcon>
          <Stack gap={0}>
            <Text size="sm" fw={600}>Approval required</Text>
            <Text size="sm" c="dimmed">{prompt.description ?? 'Hermes needs permission to continue.'}</Text>
          </Stack>
        </Group>
        {prompt.command && <CodeBlock code={prompt.command} language="bash" />}
        <Group gap={6}>
          {(['once', 'session', 'always', 'deny'] as const).map((choice) => (
            <Button
              key={choice}
              size="xs"
              disabled={sent}
              color={choice === 'deny' ? 'red' : undefined}
              variant={choice === 'once' ? 'filled' : 'light'}
              onClick={() => {
                setSent(true);
                Promise.resolve(onChoose(choice)).catch(() => setSent(false));
              }}
            >
              {APPROVAL_LABELS[choice]}
            </Button>
          ))}
        </Group>
      </Stack>
    </Paper>
  );
}

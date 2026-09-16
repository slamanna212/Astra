import { ActionIcon, Box, Button, Group, Textarea, TextInput } from '@mantine/core';
import { IconPlayerStop, IconSend } from '@tabler/icons-react';
import { useState } from 'react';

export function ChatComposer({
  running,
  onSend,
  onStop,
  onSteer,
}: {
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onSteer: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    if (running) await onSteer(value);
    else await onSend(value);
  };
  return (
    <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Textarea
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        autosize
        minRows={2}
        maxRows={8}
        placeholder={running ? 'Steer the running turn…' : 'Message Hermes…'}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Group justify="space-between" mt="xs">
        {running ? <TextInput size="xs" value="Running" readOnly variant="unstyled" /> : <span />}
        <Group gap="xs">
          {running && (
            <Button size="xs" color="red" variant="light" leftSection={<IconPlayerStop size={14} />} onClick={() => void onStop()}>
              Stop
            </Button>
          )}
          <ActionIcon size="lg" aria-label={running ? 'Send steer' : 'Send message'} onClick={() => void submit()}>
            <IconSend size={18} />
          </ActionIcon>
        </Group>
      </Group>
    </Box>
  );
}

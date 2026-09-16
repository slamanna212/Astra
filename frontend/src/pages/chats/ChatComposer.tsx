import { ActionIcon, Badge, Box, Button, FileButton, Group, Select, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { IconPaperclip, IconPlayerStop, IconX } from '@tabler/icons-react';
import { useState } from 'react';

export function ChatComposer({
  running,
  onSend,
  onStop,
  onSteer,
  model,
  provider,
  models,
  providers,
  onModelChange,
  onProviderChange,
  draft,
  onDraftChange,
  onAttach,
}: {
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onSteer: (text: string) => Promise<void>;
  model: string | null;
  provider: string | null;
  models: string[];
  providers: string[];
  onModelChange: (value: string | null) => void;
  onProviderChange: (value: string | null) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onAttach: (file: File) => Promise<string>;
}) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const handleAttach = (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    void onAttach(file)
      .then((path) => setAttachments((items) => [...items, path]))
      .catch((error: unknown) => setUploadError(error instanceof Error ? error.message : 'Upload failed'))
      .finally(() => setUploading(false));
  };
  const submit = async () => {
    const references = attachments.map((path) => `[Attached workspace file: ${path}]`).join('\n');
    const value = [references, draft.trim()].filter(Boolean).join('\n\n');
    if (!value) return;
    if (running) await onSteer(value);
    else await onSend(value);
    onDraftChange('');
    setAttachments([]);
  };
  return (
    <Box p="md" pt="sm" style={{ borderTop: '1px solid var(--astra-border)', background: 'var(--astra-bg-chrome)' }}>
      <Box
        p="sm"
        style={{
          maxWidth: 'var(--astra-chat-content-w)',
          margin: '0 auto',
          border: '1px solid var(--astra-border)',
          borderRadius: 8,
          background: 'var(--astra-surface)',
        }}
      >
        <Textarea
          variant="unstyled"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
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
        {attachments.length > 0 && (
          <Group gap={6} mt="xs">
            {attachments.map((path) => (
              <Badge key={path} variant="light" rightSection={<IconX size={11} onClick={() => setAttachments((items) => items.filter((item) => item !== path))} />}>
                {path}
              </Badge>
            ))}
          </Group>
        )}
        {uploadError && <Box c="red" fz="xs" mt={4}>{uploadError}</Box>}
        <Group justify="space-between" mt="xs" wrap="nowrap">
          <Group gap="xs" wrap="wrap">
            <FileButton onChange={handleAttach}>
              {(props) => (
                <Tooltip label="Attach a workspace file">
                  <ActionIcon {...props} variant="subtle" aria-label="Attach file" loading={uploading}>
                    <IconPaperclip size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
            </FileButton>
            <Select size="xs" aria-label="Model" placeholder="Default model" value={model} onChange={onModelChange} data={models} searchable clearable w={190} disabled={running} />
            {providers.length > 1 && <Select size="xs" aria-label="Provider" placeholder="Default provider" value={provider} onChange={onProviderChange} data={providers} searchable clearable w={145} disabled={running} />}
            {running && <TextInput size="xs" value="Running" readOnly variant="unstyled" w={65} />}
            <Text ff="monospace" fz={11} c="dimmed">
              ⇧⏎ newline
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {running && (
              <Button size="xs" color="red" variant="light" leftSection={<IconPlayerStop size={14} />} onClick={() => void onStop()}>
                Stop
              </Button>
            )}
            <Button onClick={() => void submit()} aria-label={running ? 'Send steer' : 'Send message'}>
              Send
            </Button>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}

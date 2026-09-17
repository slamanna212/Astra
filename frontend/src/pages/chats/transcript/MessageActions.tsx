import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconGitBranch, IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { regenerateChat } from '../../../api/chat';
import { getMessage } from '../../../api/messages';
import { forkSession } from '../../../api/sessions';
import type { Message } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import classes from './Transcript.module.css';

function copyText(message: Message): string {
  if (typeof message.content === 'string' && message.content) return message.content;
  if (message.content) return JSON.stringify(message.content, null, 2);
  if (message.tool_calls) return JSON.stringify(message.tool_calls, null, 2);
  if (message.reasoning) return message.reasoning;
  return '';
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the Clipboard API but reject it outside a secure context.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy was rejected');
}

export function MessageActions({
  sessionId,
  message,
  running,
  model,
  provider,
  align,
}: {
  sessionId: string;
  message: Message;
  running: boolean;
  model?: string | null;
  provider?: string | null;
  align: 'left' | 'right';
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<'fork' | 'regenerate' | null>(null);

  const copy = async () => {
    try {
      const fullMessage = await getMessage(sessionId, message.id);
      const text = copyText(fullMessage);
      if (!text) {
        notifications.show({ color: 'gray', message: 'This message has no copyable text' });
        return;
      }
      await writeClipboard(text);
      notifications.show({ color: 'green', message: 'Message copied' });
    } catch {
      notifications.show({ color: 'red', message: 'Could not access the clipboard' });
    }
  };

  const fork = async () => {
    setPending('fork');
    try {
      const session = await forkSession(sessionId, message.id);
      notifications.show({ color: 'green', message: 'Conversation forked here' });
      await navigate(`/chats/${encodeURIComponent(session.id)}`);
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Could not fork conversation',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setPending(null);
    }
  };

  const regenerate = async () => {
    setPending('regenerate');
    try {
      await regenerateChat(sessionId, { message_id: message.id, model, provider });
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Could not regenerate response',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <Group gap={3} justify={align === 'right' ? 'flex-end' : 'flex-start'} className={classes.messageFooter}>
      <Text component="span" className={classes.timestamp}>
        {formatDateTime(message.timestamp)}
        {message.truncated && ' · truncated'}
        {message.compacted && ' · from compaction summary'}
      </Text>
      <Tooltip label="Copy message">
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label="Copy message"
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            void copy();
          }}
        >
          <IconCopy size={13} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Fork conversation here">
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label="Fork conversation here"
          loading={pending === 'fork'}
          disabled={running || pending !== null}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            void fork();
          }}
        >
          <IconGitBranch size={13} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={!message.active ? 'Regenerate is unavailable for compacted history' : message.role === 'user' ? 'Retry from this message' : 'Regenerate response'}>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={message.role === 'user' ? 'Retry from this message' : 'Regenerate response'}
          loading={pending === 'regenerate'}
          disabled={!message.active || running || pending !== null}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            void regenerate();
          }}
        >
          <IconRefresh size={13} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

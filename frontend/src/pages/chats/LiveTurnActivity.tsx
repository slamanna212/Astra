import { Alert, Badge, Code, Collapse, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight } from '@tabler/icons-react';
import type { LiveActivityEvent } from '../../lib/liveActivity';
import type { ActivityDisplayMode } from '../../lib/uiPreferences';

function payloadText(event: LiveActivityEvent): string {
  if (event.text) return event.text;
  try {
    return JSON.stringify(event.data ?? {}, null, 2);
  } catch {
    return String(event.data ?? '');
  }
}

function operationLabel(event: LiveActivityEvent): string {
  const data = event.data ?? {};
  const candidate = data.name ?? data.tool_name ?? data.tool ?? data.event ?? data.status;
  if (typeof candidate === 'string' && candidate.trim()) return candidate;
  const args = data.args;
  if (Array.isArray(args) && typeof args[0] === 'string' && args[0].trim()) return args[0];
  return event.kind === 'subagent' ? 'Subagent activity' : 'Tool activity';
}

function OperationEvent({ event }: { event: LiveActivityEvent }) {
  const [opened, { toggle }] = useDisclosure(false);
  const detail = payloadText(event);
  return (
    <Paper withBorder p="xs">
      <UnstyledButton onClick={toggle} style={{ width: '100%' }}>
        <Group gap="xs" wrap="nowrap">
          <IconChevronRight
            size={13}
            style={{ transform: opened ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
          />
          <Badge size="xs" variant="light" color={event.kind === 'subagent' ? 'violet' : 'blue'}>
            {event.kind}
          </Badge>
          <Text size="xs" truncate="end" style={{ flex: 1 }}>
            {operationLabel(event)}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Code block mt="xs" style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {detail || '(no details)'}
        </Code>
      </Collapse>
    </Paper>
  );
}

function TransparentStream({ events }: { events: LiveActivityEvent[] }) {
  return (
    <Stack gap="xs" m="sm" aria-label="Transparent activity stream">
      {events.map((event, index) => {
        if (event.kind === 'tool' || event.kind === 'subagent') {
          return <OperationEvent key={`${event.kind}-${index}`} event={event} />;
        }
        return (
          <Paper key={`${event.kind}-${index}`} withBorder p="xs">
            <Text size="xs" c="dimmed" fw={600} mb={4}>
              {event.kind === 'reasoning' ? 'Thinking' : 'Assistant'}
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {event.text}
            </Text>
          </Paper>
        );
      })}
    </Stack>
  );
}

function CompactWorklog({ events }: { events: LiveActivityEvent[] }) {
  const [opened, { toggle }] = useDisclosure(false);
  const reasoning = events.filter((event) => event.kind === 'reasoning').map(payloadText).join('');
  const response = events.filter((event) => event.kind === 'assistant').map(payloadText).join('');
  const operations = events.filter((event) => event.kind === 'tool' || event.kind === 'subagent');
  const tools = operations.filter((event) => event.kind === 'tool').length;
  const subagents = operations.length - tools;

  return (
    <Stack gap="xs" m="sm" aria-label="Compact activity worklog">
      {reasoning && <Alert color="gray" title="Thinking">{reasoning}</Alert>}
      {response && <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{response}</Text>}
      {operations.length > 0 && (
        <Paper withBorder p="xs">
          <UnstyledButton onClick={toggle} style={{ width: '100%' }}>
            <Group gap="xs">
              <IconChevronRight size={13} style={{ transform: opened ? 'rotate(90deg)' : undefined }} />
              <Text size="xs" fw={600}>Worklog</Text>
              <Text size="xs" c="dimmed">
                {tools} tool event{tools === 1 ? '' : 's'}{subagents ? ` · ${subagents} subagent event${subagents === 1 ? '' : 's'}` : ''}
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse expanded={opened}>
            <Stack gap={6} mt="xs">
              {operations.map((event, index) => <OperationEvent key={`${event.kind}-${index}`} event={event} />)}
            </Stack>
          </Collapse>
        </Paper>
      )}
    </Stack>
  );
}

export function LiveTurnActivity({ events, mode }: { events: LiveActivityEvent[]; mode: ActivityDisplayMode }) {
  if (events.length === 0) return null;
  return mode === 'transparent_stream'
    ? <TransparentStream events={events} />
    : <CompactWorklog events={events} />;
}

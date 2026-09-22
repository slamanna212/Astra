import { Drawer, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { MAX_LIVE_ACTIVITY_EVENTS, type LiveActivityEvent } from '../../../lib/liveActivity';
import { isWorkspaceActivity } from '../../../lib/liveTurn';

function eventLabel(event: LiveActivityEvent): string {
  const data = event.data ?? {};
  const candidate = [data.name, data.tool_name, data.tool, data.message, data.status]
    .find((value) => typeof value === 'string' && value.trim());
  return candidate ? String(candidate) : event.kind;
}

function WorkspaceEvent({ event }: { event: LiveActivityEvent }) {
  const [open, setOpen] = useState(false);
  const data = event.data ?? {};
  return (
    <Paper withBorder p="xs">
      <Text size="xs" fw={600}>{event.kind}: {eventLabel(event)}</Text>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Event details</button>
      {open && (
        <Text component="pre" size="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>
          {JSON.stringify(data, null, 2)}
        </Text>
      )}
    </Paper>
  );
}

/**
 * Owned by the transcript rather than the live row: the row is a placeholder that disappears when
 * canonical history arrives, and the drawer must not close under the reader at that moment.
 */
export function AgentWorkspaceDrawer({
  opened,
  onClose,
  events,
}: {
  opened: boolean;
  onClose: () => void;
  events: LiveActivityEvent[];
}) {
  const activities = events.filter(isWorkspaceActivity);
  // The retained list is capped, so at capacity it holds the most recent entries and no more.
  const atCapacity = activities.length >= MAX_LIVE_ACTIVITY_EVENTS;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Agent workspace"
      position="right"
      size="min(420px, 100%)"
      keepMounted={false}
    >
      <Text size="xs" c="dimmed">
        Live activity for the current turn, in arrival order. This is not a durable audit log.
      </Text>
      {atCapacity && (
        <Text size="xs" c="dimmed" mt={4}>
          Showing the most recent {MAX_LIVE_ACTIVITY_EVENTS} events. Earlier activity is not kept in this view.
        </Text>
      )}
      {activities.length === 0
        ? <Text size="sm" mt="xs" c="dimmed">No agent activity yet.</Text>
        : (
          <Stack gap="xs" mt="xs" aria-label="Agent workspace timeline">
            {activities.map((event, index) => <WorkspaceEvent key={index} event={event} />)}
          </Stack>
        )}
    </Drawer>
  );
}

import { Alert, Badge, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Text, Title, useMantineColorScheme } from '@mantine/core';
import { IconAlertCircle, IconMoon, IconSun, IconDeviceDesktop } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { getStatus } from '../../api/auth';
import { queryKeys } from '../../api/queryKeys';
import { formatCount } from '../../lib/format';
import { type BusyTurnMode, type ChatFontSize, updateUiPreferences, useUiPreferences } from '../../lib/uiPreferences';

function StatusFact({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Group gap={6} wrap="nowrap">
        {ok !== undefined && <span data-testid={`status-dot-${ok ? 'ok' : 'down'}`} style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? 'var(--astra-ok)' : 'var(--astra-danger)', flexShrink: 0 }} />}
        <Text size="sm" ff={ok !== undefined ? 'monospace' : undefined}>
          {value}
        </Text>
      </Group>
    </div>
  );
}

export default function SettingsPage() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const prefs = useUiPreferences();
  const status = useQuery({ queryKey: queryKeys.status, queryFn: ({ signal }) => getStatus(signal) });

  return (
    <Stack p="md" gap="md" maw={720}>
      <Title order={1}>Settings</Title>

      <Card withBorder p="md">
        <Title order={3} mb="sm">
          Appearance
        </Title>
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Color scheme
          </Text>
          <SegmentedControl
            aria-label="Color scheme"
            value={colorScheme}
            onChange={(value) => setColorScheme(value as 'light' | 'dark' | 'auto')}
            data={[
              { label: <Group gap={6} wrap="nowrap"><IconSun size={14} /><span>Light</span></Group>, value: 'light' },
              { label: <Group gap={6} wrap="nowrap"><IconMoon size={14} /><span>Dark</span></Group>, value: 'dark' },
              { label: <Group gap={6} wrap="nowrap"><IconDeviceDesktop size={14} /><span>Auto</span></Group>, value: 'auto' },
            ]}
          />
        </Stack>
      </Card>

      <Card withBorder p="md">
        <Title order={3} mb="sm">
          Chat
        </Title>
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Font size
          </Text>
          <SegmentedControl
            aria-label="Chat font size"
            value={prefs.chatFontSize}
            onChange={(value) => updateUiPreferences({ chatFontSize: value as ChatFontSize })}
            data={[
              { label: 'Small', value: 'sm' },
              { label: 'Medium', value: 'md' },
              { label: 'Large', value: 'lg' },
              { label: 'Extra large', value: 'xl' },
            ]}
          />
          <Text size="sm" c="dimmed" mt="sm">
            While Hermes is responding
          </Text>
          <SegmentedControl
            aria-label="Busy turn mode"
            value={prefs.busyTurnMode}
            onChange={(value) => updateUiPreferences({ busyTurnMode: value as BusyTurnMode })}
            data={[
              { label: 'Queue', value: 'queue' },
              { label: 'Interrupt', value: 'interrupt' },
              { label: 'Steer', value: 'steer' },
            ]}
          />
          <Text size="xs" c="dimmed">
            Queue waits for the current turn. Interrupt stops it and starts your message next. Steer applies your message to the running turn.
          </Text>
        </Stack>
      </Card>

      <Card withBorder p="md">
        <Title order={3} mb="sm">
          Sidebar
        </Title>
        <Switch
          label="Collapse sidebar by default"
          description="Applies on desktop widths; the mobile sidebar is always collapsed until opened."
          checked={prefs.sidebarDesktopCollapsed}
          onChange={(e) => updateUiPreferences({ sidebarDesktopCollapsed: e.currentTarget.checked })}
        />
      </Card>

      <Card withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={3}>System</Title>
          {status.data && (
            <Badge color={status.data.state_db_ok ? 'green' : 'red'}>
              {status.data.state_db_ok ? 'Healthy' : 'Degraded'}
            </Badge>
          )}
        </Group>

        {status.isPending && <Loader size="sm" />}
        {status.isError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="Failed to load system status">
            {status.error instanceof Error ? status.error.message : 'Could not reach the backend.'}
          </Alert>
        )}
        {status.data && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <StatusFact label="Astra version" value={`v${status.data.version}`} />
            <StatusFact label="State database" value={status.data.state_db_ok ? 'Connected' : 'Unreachable'} ok={status.data.state_db_ok} />
            <StatusFact label="Hermes home" value={status.data.hermes_home_exists ? 'Found' : 'Missing'} ok={status.data.hermes_home_exists} />
            <StatusFact label="Session count" value={formatCount(status.data.session_count)} />
            <StatusFact label="Journal mode" value={status.data.journal_mode ?? '—'} />
            <StatusFact
              label="Hermes source"
              value={status.data.hermes_src_configured ? (status.data.hermes_importable ? 'Configured, importable' : 'Configured, not importable') : 'Not configured'}
              ok={status.data.hermes_src_configured ? status.data.hermes_importable : undefined}
            />
          </SimpleGrid>
        )}
      </Card>
    </Stack>
  );
}

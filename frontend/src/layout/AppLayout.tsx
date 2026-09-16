import { ActionIcon, AppShell, Burger, Center, Group, Loader, NavLink, Text, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { spotlight } from '@mantine/spotlight';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconLogout, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { getHealth, logout } from '../api/auth';
import { queryKeys } from '../api/queryKeys';
import { markSignedOut } from '../auth/session';
import { SearchSpotlight } from '../components/SearchSpotlight';
import { updateUiPreferences, useUiPreferences } from '../lib/uiPreferences';
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { NAV_ITEMS } from './navItems';

export const HEADER_HEIGHT = 56;

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefs = useUiPreferences();

  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: Infinity,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: (_data, error) => {
      if (error) {
        notifications.show({ color: 'red', title: 'Logout failed', message: error.message });
        return;
      }
      queryClient.setQueryData(queryKeys.auth.me, false);
      void Promise.resolve(navigate('/login', { replace: true })).then(() => markSignedOut(queryClient));
    },
  });

  return (
    <AppShell
      header={{ height: HEADER_HEIGHT }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened, desktop: prefs.sidebarDesktopCollapsed } }}
      padding={0}
    >
      <SearchSpotlight />
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Title order={3} fw={700}>
              Astra
            </Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={prefs.sidebarDesktopCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              <ActionIcon
                visibleFrom="sm"
                variant="default"
                size="lg"
                aria-label={prefs.sidebarDesktopCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                onClick={() => updateUiPreferences({ sidebarDesktopCollapsed: !prefs.sidebarDesktopCollapsed })}
              >
                {prefs.sidebarDesktopCollapsed ? <IconLayoutSidebarLeftExpand size={18} /> : <IconLayoutSidebarLeftCollapse size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Search (Ctrl/Cmd+K)">
              <ActionIcon variant="default" size="lg" aria-label="Search" onClick={() => spotlight.open()}>
                <IconSearch size={18} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
            <ColorSchemeToggle />
            <Tooltip label="Log out">
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Log out"
                loading={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
              >
                <IconLogout size={18} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow>
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <NavLink
                key={item.to}
                component={Link}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={18} stroke={1.5} />}
                active={active}
                aria-current={active ? 'page' : undefined}
                onClick={close}
              />
            );
          })}
        </AppShell.Section>
        <AppShell.Section px="sm" pb="xs">
          <Text size="xs" c="dimmed">
            {health.data ? `v${health.data.version}` : ' '}
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main h="100dvh">
        <Suspense
          fallback={
            <Center h={`calc(100dvh - ${HEADER_HEIGHT}px)`}>
              <Loader />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}

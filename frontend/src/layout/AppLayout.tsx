import { ActionIcon, AppShell, Burger, Center, Group, Loader, NavLink, Tooltip, UnstyledButton } from '@mantine/core';
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
import { BrandMark } from '../components/BrandMark';
import { SearchSpotlight } from '../components/SearchSpotlight';
import { updateUiPreferences, useUiPreferences } from '../lib/uiPreferences';
import classes from './AppLayout.module.css';
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
            <BrandMark size={24} />
            <span className={classes.brandTitle}>Astra</span>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={prefs.sidebarDesktopCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              <ActionIcon
                visibleFrom="sm"
                aria-label={prefs.sidebarDesktopCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                onClick={() => updateUiPreferences({ sidebarDesktopCollapsed: !prefs.sidebarDesktopCollapsed })}
              >
                {prefs.sidebarDesktopCollapsed ? (
                  <IconLayoutSidebarLeftExpand size={18} stroke={1.5} />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={18} stroke={1.5} />
                )}
              </ActionIcon>
            </Tooltip>
            <UnstyledButton
              className={classes.searchTrigger}
              onClick={() => spotlight.open()}
              aria-label="Search (Ctrl/Cmd+K)"
            >
              <IconSearch size={15} stroke={1.5} />
              <span>Search</span>
              <span className={classes.searchShortcut}>⌘K</span>
            </UnstyledButton>
            <ColorSchemeToggle />
            <Tooltip label="Log out">
              <ActionIcon aria-label="Log out" loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>
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
                className={classes.navItem}
                classNames={{ root: active ? classes.navItemActive : undefined }}
              />
            );
          })}
        </AppShell.Section>
        <AppShell.Section p="xs">
          <div className={classes.statusCard}>
            <div className={classes.statusLabel}>
              {health.data ? (health.data.state_db.ok ? 'agent online' : 'agent offline') : ' '}
            </div>
            <Group gap={6} wrap="nowrap">
              <span
                className={`${classes.statusDot} ${health.data?.state_db.ok ? classes.statusDotOk : classes.statusDotDown}`}
              />
              <span className={classes.statusMeta}>{health.data ? `v${health.data.version}` : ' '}</span>
            </Group>
          </div>
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

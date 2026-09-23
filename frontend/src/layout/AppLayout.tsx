import { ActionIcon, AppShell, Burger, Center, Group, Loader, NavLink, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { spotlight } from '@mantine/spotlight';
import { IconLogout, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { getHealth, logout } from '../api/auth';
import { queryKeys } from '../api/queryKeys';
import { markSignedOut } from '../auth/session';
import { BrandMark } from '../components/BrandMark';
import { SearchSpotlight } from '../components/SearchSpotlight';
import { CHAT_FONT_SIZES, useUiPreferences } from '../lib/uiPreferences';
import classes from './AppLayout.module.css';
import { NAV_ITEMS } from './navItems';

export const HEADER_HEIGHT = 48;

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefs = useUiPreferences();

  useEffect(() => {
    document.documentElement.style.setProperty('--astra-chat-font-size', `${CHAT_FONT_SIZES[prefs.chatFontSize]}px`);
  }, [prefs.chatFontSize]);

  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: Infinity,
  });

  const activeNavItem = NAV_ITEMS.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  );

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
      navbar={{
        width: { base: 240, sm: 60 },
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding={0}
    >
      <SearchSpotlight />
      <AppShell.Header withBorder={false} className={classes.shellChrome}>
        <div className={`${classes.headerInner} ${classes.headerGrid}`}>
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <BrandMark size={24} />
            <span className={classes.brandTitle}>Astra</span>
            {activeNavItem && (
              <>
                <span className={classes.brandDivider}>/</span>
                <span className={classes.brandSection}>{activeNavItem.label}</span>
              </>
            )}
          </Group>
          <UnstyledButton
            className={classes.searchTrigger}
            onClick={() => spotlight.open()}
            aria-label="Search (Ctrl/Cmd+K)"
          >
            <IconSearch size={15} stroke={1.5} />
            <span className={classes.searchLabel}>Search</span>
            <span className={classes.searchShortcut}>⌘K</span>
          </UnstyledButton>
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            <Tooltip label="Log out">
              <ActionIcon
                aria-label="Log out"
                loading={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
                classNames={{ root: classes.headerIconBtn }}
              >
                <IconLogout size={18} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>
      </AppShell.Header>

      <AppShell.Navbar p="xs" withBorder={false} className={classes.shellChrome} zIndex={opened ? 103 : undefined}>
        <AppShell.Section grow>
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <Tooltip key={item.to} label={item.label} position="right" openDelay={200} visibleFrom="sm">
                <NavLink
                  component={Link}
                  to={item.to}
                  label={item.label}
                  leftSection={<item.icon size={18} stroke={1.5} />}
                  active={active}
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                  className={classes.navItem}
                  classNames={{ root: active ? classes.navItemActive : undefined, body: classes.navItemBody, section: classes.navItemSection }}
                />
              </Tooltip>
            );
          })}
        </AppShell.Section>
        <AppShell.Section p="xs">
          <div className={classes.statusCard}>
            <div className={classes.statusLabel}>
              {health.data ? (health.data.state_db.ok ? 'agent online' : 'agent offline') : ' '}
            </div>
            <Group gap={6} wrap="nowrap">
              <span className={classes.statusDotWrap}>
                <span
                  className={`${classes.statusDot} ${health.data?.state_db.ok ? classes.statusDotOk : classes.statusDotDown}`}
                />
              </span>
              <span className={classes.statusMeta}>{health.data ? `v${health.data.version}` : ' '}</span>
            </Group>
          </div>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main h="100dvh" className={classes.shellChrome}>
        <div className={classes.contentShell}>
          <Suspense
            fallback={
              <Center h={`calc(100dvh - ${HEADER_HEIGHT}px)`}>
                <Loader />
              </Center>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

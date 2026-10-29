import { Anchor, Button, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { listProfiles } from '../api/profiles';
import { queryKeys } from '../api/queryKeys';
import { currentProfile, pathForProfile } from '../lib/profileScope';

/**
 * Guards a `/p/<name>` document against a profile that does not exist (deleted bot, typo,
 * stale link). Everything else in the app assumes the profile is real — every request,
 * stream and cache key hangs off it — so this is the only place that checks.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const roster = useQuery({
    queryKey: queryKeys.profiles.list,
    queryFn: ({ signal }) => listProfiles(signal),
    retry: false,
    staleTime: 30_000,
  });

  if (currentProfile === 'default') return <>{children}</>;

  if (roster.isPending) {
    return (
      <Center h="100dvh">
        <Loader size="sm" />
      </Center>
    );
  }

  // A failed roster is not proof the profile is missing — let the app try and report honestly.
  if (roster.isError) return <>{children}</>;

  const exists = (roster.data?.items ?? []).some((row) => row.name === currentProfile);
  if (exists) return <>{children}</>;

  return (
    <Center h="100dvh">
      <Stack align="center" gap="xs" maw={380}>
        <Title order={3} fz={18}>
          That bot is not here
        </Title>
        <Text fz={13} c="dimmed" ta="center">
          There is no bot called <code>{currentProfile}</code>. It may have been deleted, or the
          link may be from another profile.
        </Text>
        <Button component="a" href={pathForProfile('default', '/bots')} variant="light" mt="sm">
          See all bots
        </Button>
        <Anchor href={pathForProfile('default', '/chats')} fz={12}>
          Go to the default profile
        </Anchor>
      </Stack>
    </Center>
  );
}

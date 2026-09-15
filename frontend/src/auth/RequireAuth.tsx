import { Button, Center, Loader, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuthStatus } from './useAuth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const auth = useAuthStatus();

  if (auth.isPending) {
    return (
      <Center h="100dvh">
        <Loader aria-label="Checking session" />
      </Center>
    );
  }

  if (auth.isError) {
    return (
      <Center h="100dvh">
        <Stack align="center" gap="sm">
          <Text c="dimmed">Could not reach the Astra server.</Text>
          <Button variant="light" onClick={() => void auth.refetch()}>
            Retry
          </Button>
        </Stack>
      </Center>
    );
  }

  if (!auth.data) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}

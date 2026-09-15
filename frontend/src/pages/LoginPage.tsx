import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { login } from '../api/auth';
import { isApiError } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuthStatus } from '../auth/useAuth';
import { safeRedirectPath } from '../lib/safeRedirect';

function loginErrorMessage(error: unknown): string {
  if (isApiError(error, 401)) return 'Incorrect password.';
  if (isApiError(error, 429)) {
    const retryAfter = Number(error.headers?.get('retry-after'));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `Too many attempts. Try again in ${Math.ceil(retryAfter)} seconds.`
      : 'Too many attempts. Please wait before trying again.';
  }
  if (isApiError(error)) return `Login failed (${error.status}).`;
  return 'Could not reach the server.';
}

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthStatus();
  const next = safeRedirectPath(searchParams.get('next'));

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, true);
      void navigate(next, { replace: true });
    },
  });

  if (auth.data === true && !mutation.isPending) {
    return <Navigate to={next} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!password || mutation.isPending) return;
    mutation.mutate(password);
  };

  return (
    <Center mih="100dvh" p="md">
      <Paper withBorder shadow="sm" radius="md" p="xl" w="100%" maw={380}>
        <form onSubmit={onSubmit}>
          <Stack gap="md">
            <div>
              <Title order={2}>Astra</Title>
              <Text c="dimmed" size="sm">
                Sign in to continue
              </Text>
            </div>
            {mutation.isError && (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} role="alert">
                {loginErrorMessage(mutation.error)}
              </Alert>
            )}
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={isApiError(mutation.error, 401) ? true : undefined}
            />
            <Button type="submit" loading={mutation.isPending} disabled={!password} fullWidth>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

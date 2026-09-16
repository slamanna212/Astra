import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/code-highlight/styles.css';
import '@mantine/dropzone/styles.css';
import './styles/tokens.css';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { setUnauthorizedHandler } from './api/client';
import { queryKeys } from './api/queryKeys';
import { markSignedOut } from './auth/session';
import { createQueryClient } from './lib/queryClient';
import { createAppRouter } from './router';
import { theme } from './theme';

const queryClient = createQueryClient();
const router = createAppRouter();

// Any 401 from an authenticated call: drop cached server state and send the user to /login,
// remembering where they were.
setUnauthorizedHandler(() => {
  const { pathname, search, hash } = router.state.location;
  if (pathname === '/login') return;
  const next = encodeURIComponent(`${pathname}${search}${hash}`);
  queryClient.setQueryData(queryKeys.auth.me, false);
  void router.navigate(`/login?next=${next}`, { replace: true }).then(() => markSignedOut(queryClient));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          <Suspense fallback={null}>
            <RouterProvider router={router} />
          </Suspense>
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);

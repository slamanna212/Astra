import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';

// Route-level code splitting: each area ships in its own chunk.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ChatsPage = lazy(() => import('./pages/chats/ChatsPage'));
const ChatsIndex = lazy(() => import('./pages/chats/ChatsIndex'));
const SessionPane = lazy(() => import('./pages/chats/SessionPane'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const placeholders: Array<{ path: string; title: string }> = [
  { path: 'cron', title: 'Scheduled tasks' },
  { path: 'skills', title: 'Skills' },
  { path: 'memories', title: 'Memories' },
  { path: 'files', title: 'Files' },
  { path: 'insights', title: 'Insights' },
  { path: 'logs', title: 'Logs' },
];

export function createAppRouter() {
  return createBrowserRouter([
    { path: '/login', element: <LoginPage /> },
    {
      path: '/',
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <Navigate to="/chats" replace /> },
        {
          path: 'chats',
          element: <ChatsPage />,
          children: [
            { index: true, element: <ChatsIndex /> },
            { path: ':sessionId', element: <SessionPane /> },
          ],
        },
        ...placeholders.map(({ path, title }) => ({ path, element: <PlaceholderPage title={title} /> })),
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ]);
}

import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';

// Route-level code splitting: each area ships in its own chunk.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ChatsPage = lazy(() => import('./pages/chats/ChatsPage'));
const ChatsIndex = lazy(() => import('./pages/chats/ChatsIndex'));
const SessionPane = lazy(() => import('./pages/chats/SessionPane'));
const CronPage = lazy(() => import('./pages/cron/CronPage'));
const CronIndex = lazy(() => import('./pages/cron/CronIndex'));
const CronDetail = lazy(() => import('./pages/cron/CronDetail'));
const SkillsPage = lazy(() => import('./pages/skills/SkillsPage'));
const SkillIndex = lazy(() => import('./pages/skills/SkillIndex'));
const SkillDetail = lazy(() => import('./pages/skills/SkillDetail'));
const MemoriesPage = lazy(() => import('./pages/memories/MemoriesPage'));
const InsightsPage = lazy(() => import('./pages/insights/InsightsPage'));
const FilesPage = lazy(() => import('./pages/files/FilesPage'));
const LogsPage = lazy(() => import('./pages/logs/LogsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

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
        { path: 'insights', element: <InsightsPage /> },
        { path: 'files', element: <FilesPage /> },
        { path: 'logs', element: <LogsPage /> },
        {
          path: 'cron',
          element: <CronPage />,
          children: [
            { index: true, element: <CronIndex /> },
            { path: ':jobId', element: <CronDetail /> },
          ],
        },
        {
          path: 'skills',
          element: <SkillsPage />,
          children: [
            { index: true, element: <SkillIndex /> },
            { path: ':category/:name', element: <SkillDetail /> },
            { path: ':name', element: <SkillDetail /> },
          ],
        },
        { path: 'memories', element: <MemoriesPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ]);
}

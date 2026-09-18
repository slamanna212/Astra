import type { InsightsRange, SessionListFilters } from './types';

/** Centralised TanStack Query keys. Hierarchical so `sessions.all` invalidates every session query. */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  health: ['health'] as const,
  status: ['status'] as const,
  sessions: {
    all: ['sessions'] as const,
    lists: () => [...queryKeys.sessions.all, 'list'] as const,
    list: (filters: Required<SessionListFilters>) => [...queryKeys.sessions.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.sessions.all, 'detail', id] as const,
    count: (source: string[] | null) => [...queryKeys.sessions.all, 'count', 'archived', source] as const,
  },
  insights: {
    all: ['insights'] as const,
    report: (days: InsightsRange, tz: string) => [...queryKeys.insights.all, days, tz] as const,
  },
  files: {
    all: ['files'] as const,
    listing: (path: string) => [...queryKeys.files.all, 'listing', path] as const,
    content: (path: string) => [...queryKeys.files.all, 'content', path] as const,
    git: (path: string) => [...queryKeys.files.all, 'git', path] as const,
  },
  terminal: ['terminal'] as const,
  logs: {
    all: ['logs'] as const,
    tail: (file: string, params: { lines: number; level: string | null; search: string | null }) =>
      [...queryKeys.logs.all, 'tail', file, params] as const,
  },
  messages: {
    all: (sessionId: string) => ['messages', sessionId] as const,
    window: (sessionId: string, aroundId: number | undefined) =>
      [...queryKeys.messages.all(sessionId), 'window', aroundId ?? 'latest'] as const,
    detail: (sessionId: string, messageId: number) =>
      [...queryKeys.messages.all(sessionId), 'detail', messageId] as const,
    children: (sessionId: string) => [...queryKeys.messages.all(sessionId), 'children'] as const,
  },
  search: {
    all: ['search'] as const,
    query: (q: string, source: string | null) => [...queryKeys.search.all, q, source] as const,
  },
  cron: {
    all: ['cron'] as const,
    list: () => [...queryKeys.cron.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.cron.all, 'detail', id] as const,
    script: (id: string, field: string) => [...queryKeys.cron.all, 'script', id, field] as const,
    output: (id: string, cursor: string | null) => [...queryKeys.cron.all, 'output', id, cursor] as const,
    outputContent: (id: string, run: string) => [...queryKeys.cron.all, 'output-content', id, run] as const,
  },
  skills: {
    all: ['skills'] as const,
    list: () => [...queryKeys.skills.all, 'list'] as const,
    detail: (category: string | null, name: string) => [...queryKeys.skills.all, 'detail', category, name] as const,
    file: (category: string | null, name: string, path: string) =>
      [...queryKeys.skills.all, 'file', category, name, path] as const,
  },
  openviking: {
    all: ['openviking'] as const,
    tree: (uri: string) => [...queryKeys.openviking.all, 'tree', uri] as const,
    stat: (uri: string) => [...queryKeys.openviking.all, 'stat', uri] as const,
    content: (uri: string, offset = 0) => [...queryKeys.openviking.all, 'content', uri, offset] as const,
    health: () => [...queryKeys.openviking.all, 'health'] as const,
    status: () => [...queryKeys.openviking.all, 'status'] as const,
  },
};

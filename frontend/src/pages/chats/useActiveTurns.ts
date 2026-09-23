import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getActiveTurns } from '../../api/chat';
import { queryKeys } from '../../api/queryKeys';

export type RunState = 'running' | 'waiting';

/** Poll cadence for the chat list's live dots. The payload is a few bytes of in-memory state;
    TanStack pauses interval refetches while the tab is hidden and refetches on focus. */
const ACTIVE_POLL_MS = 3_000;

/** session id → run state, for every turn the backend is running. Idle sessions are absent. */
export function useActiveTurns(): ReadonlyMap<string, RunState> {
  const { data } = useQuery({
    queryKey: queryKeys.chat.active(),
    queryFn: ({ signal }) => getActiveTurns(signal),
    refetchInterval: ACTIVE_POLL_MS,
  });
  return useMemo(
    () => new Map((data?.turns ?? []).map((t) => [t.session_id, t.waiting ? 'waiting' : 'running'] as const)),
    [data],
  );
}

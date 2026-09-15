import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';

/**
 * Mark the user signed out and drop all other cached server state.
 * `auth.me` is set to false (not removed) so /login doesn't see a stale `true` and bounce back.
 */
export function markSignedOut(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.auth.me, false);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.auth.me[0] });
}

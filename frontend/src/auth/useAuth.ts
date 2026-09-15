import { useQuery } from '@tanstack/react-query';
import { checkAuthenticated } from '../api/auth';
import { queryKeys } from '../api/queryKeys';

export function useAuthStatus() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: ({ signal }) => checkAuthenticated(signal),
    staleTime: Infinity,
    retry: false,
  });
}

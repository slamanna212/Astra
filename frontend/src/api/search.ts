import { apiFetch } from './client';
import type { Page, SearchHit } from './types';

export const SEARCH_PAGE_SIZE = 20;

export interface SearchParams {
  q: string;
  limit?: number;
  cursor?: string | null;
  source?: string | null;
}

export function search(params: SearchParams, signal?: AbortSignal): Promise<Page<SearchHit>> {
  return apiFetch<Page<SearchHit>>('/search', {
    signal,
    query: {
      q: params.q,
      limit: params.limit ?? SEARCH_PAGE_SIZE,
      cursor: params.cursor,
      source: params.source,
    },
  });
}

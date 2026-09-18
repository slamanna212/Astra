import { InfiniteQueryObserver, QueryClient, type InfiniteData } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMessages, type MessageWindowParams } from '../api/messages';
import { queryKeys } from '../api/queryKeys';
import type { Message, MessagePage } from '../api/types';
import { refreshMessages } from './refreshMessages';

vi.mock('../api/messages', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/messages')>(),
  listMessages: vi.fn(),
}));

const key = queryKeys.messages.window('s1', undefined);
const clients: QueryClient[] = [];
const unsubscribers: (() => void)[] = [];
type Windows = InfiniteData<MessagePage, MessageWindowParams>;

function page(start: number, end: number, hasNewer = false): MessagePage {
  return {
    items: Array.from({ length: end - start + 1 }, (_, index) => ({ id: start + index } as Message)),
    oldest_id: start, newest_id: end, has_older: start > 1, has_newer: hasNewer,
  };
}

function setup(pages = [page(1, 200, true), page(201, 400, true), page(401, 600, true), page(601, 800, true), page(801, 1000)]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  clients.push(client);
  const queryFn = vi.fn(async ({ pageParam }: { pageParam: MessageWindowParams }) =>
    pages.find((p) => p.oldest_id === (pageParam.after_id ?? 0) + 1) ?? page(1001, 1002));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn,
    initialPageParam: { after_id: 0 } as MessageWindowParams,
    initialData: { pages, pageParams: pages.map((p): MessageWindowParams => ({ after_id: p.oldest_id! - 1 })) },
    getNextPageParam: (last) => last.has_newer ? { after_id: last.newest_id! } : undefined,
    getPreviousPageParam: (first) => first.has_older ? { before_id: first.oldest_id! } : undefined,
  });
  unsubscribers.push(observer.subscribe(() => {}));
  return { client, queryFn, observer, data: () => client.getQueryData<Windows>(key)! };
}

afterEach(() => {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((client) => client.clear());
  vi.mocked(listMessages).mockReset();
});

describe('incremental message refresh', () => {
  it('fetches only additions to five loaded pages and fills short tails across turns', async () => {
    const { client, queryFn, data } = setup();
    const firstPage = data().pages[0];
    vi.mocked(listMessages).mockResolvedValueOnce(page(1001, 1003));
    await refreshMessages(client, 's1');
    expect(queryFn).not.toHaveBeenCalled();
    expect(listMessages).toHaveBeenCalledExactlyOnceWith('s1', { after_id: 1000 }, undefined);
    expect(data().pages).toHaveLength(6);
    expect(data().pages[0]).toBe(firstPage);
    expect(data().pages[4]!.has_newer).toBe(true);
    expect(data().pageParams.at(-1)).toEqual({ after_id: 1000 });

    vi.mocked(listMessages).mockResolvedValueOnce(page(1004, 1005));
    await refreshMessages(client, 's1');
    expect(data().pages).toHaveLength(6);
    expect(data().pages.at(-1)?.items.map((m) => m.id)).toEqual([1001, 1002, 1003, 1004, 1005]);
  });

  it('fetches all additions for a turn larger than one page', async () => {
    const { client, data } = setup();
    vi.mocked(listMessages).mockResolvedValueOnce(page(1001, 1200, true)).mockResolvedValueOnce(page(1201, 1205));
    await refreshMessages(client, 's1');
    expect(listMessages).toHaveBeenNthCalledWith(2, 's1', { after_id: 1200 }, undefined);
    expect(data().pages).toHaveLength(7);
    expect(data().pages.at(-1)?.newest_id).toBe(1205);
    expect(data().pageParams.at(-1)).toEqual({ after_id: 1200 });
  });

  it('does not fetch the gap after a deep-linked window', async () => {
    const { client, data, queryFn } = setup([page(201, 400, true)]);
    const before = data();
    await refreshMessages(client, 's1');
    expect(listMessages).not.toHaveBeenCalled();
    expect(queryFn).not.toHaveBeenCalled();
    expect(data()).toBe(before);
  });

  it('reconciles existing rows for compaction, regeneration, and reconnects', async () => {
    const { client, queryFn, data } = setup([page(1, 2)]);
    queryFn.mockResolvedValueOnce({ ...page(1, 2), items: [{ id: 2, compacted: true } as Message] });
    await refreshMessages(client, 's1', { reconcile: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(data().pages[0]!.items).toEqual([{ id: 2, compacted: true }]);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('preserves older pages loaded while the incremental request is pending', async () => {
    const { client, data } = setup([page(201, 400)]);
    let resolve!: (page: MessagePage) => void;
    vi.mocked(listMessages).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const refreshing = refreshMessages(client, 's1');
    await vi.waitFor(() => expect(listMessages).toHaveBeenCalled());
    client.setQueryData<Windows>(key, (current) => ({
      pages: [page(1, 200, true), ...current!.pages],
      pageParams: [{ after_id: 0 }, ...current!.pageParams],
    }));
    resolve(page(401, 402));
    await refreshing;
    expect(data().pages[0]!.oldest_id).toBe(1);
    expect(data().pages.at(-1)?.newest_id).toBe(402);
  });

  it('does not overwrite a replacement snapshot received during the request', async () => {
    const { client, data } = setup();
    vi.mocked(listMessages).mockImplementationOnce(async () => {
      client.setQueryData(key, { pages: [page(2001, 2002)], pageParams: [{}] });
      return page(1001, 1002);
    });
    await refreshMessages(client, 's1');
    expect(data().pages).toEqual([page(2001, 2002)]);
  });

  it('waits for a concurrent older-page request before committing additions', async () => {
    const { client, data, observer, queryFn } = setup([page(201, 400)]);
    let resolveTail!: (value: MessagePage) => void;
    let resolveOlder!: (value: MessagePage) => void;
    vi.mocked(listMessages).mockImplementationOnce(() => new Promise((resolve) => { resolveTail = resolve; }));
    const refreshing = refreshMessages(client, 's1');
    await vi.waitFor(() => expect(listMessages).toHaveBeenCalled());
    queryFn.mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }));
    const paging = observer.fetchPreviousPage();
    resolveTail(page(401, 402));
    // Give the incremental response a chance to commit before the slower history response.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveOlder(page(1, 200, true));
    await Promise.all([refreshing, paging]);
    expect(data().pages[0]!.oldest_id).toBe(1);
    expect(data().pages.at(-1)?.newest_id).toBe(402);
  });

  it('refetches an empty conversation to pick up its first turn', async () => {
    const { client, queryFn, data } = setup([{ items: [], oldest_id: null, newest_id: null, has_older: false, has_newer: false }]);
    queryFn.mockResolvedValueOnce(page(1, 2));
    await refreshMessages(client, 's1');
    expect(data().pages[0]!.newest_id).toBe(2);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

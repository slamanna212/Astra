import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { listMessages, MESSAGE_PAGE_SIZE, type MessageWindowParams } from '../api/messages';
import { queryKeys } from '../api/queryKeys';
import type { Message, MessagePage } from '../api/types';

type MessageWindows = InfiniteData<MessagePage, MessageWindowParams>;

/** Refresh an observed, append-only turn without downloading previously loaded history.
 * Reconnects and history mutations still reconcile against the canonical windows. */
export async function refreshMessages(
  client: QueryClient,
  sessionId: string,
  { reconcile = false, signal }: { reconcile?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const queryKey = queryKeys.messages.all(sessionId);
  if (reconcile) {
    await client.invalidateQueries({ queryKey }, { throwOnError: true });
    return;
  }

  // Other cached views should reconcile when revisited; only the visible window needs updates now.
  await client.invalidateQueries({ queryKey, type: 'inactive', refetchType: 'none' });
  const windows = client.getQueryCache().findAll({
    queryKey,
    type: 'active',
    predicate: (query) => query.queryKey[2] === 'window',
  });
  await Promise.all(windows.map(async (query) => {
    // Let an in-flight history page settle before capturing the tail. Otherwise its response
    // could overwrite the additions. A subsequent prepend is preserved by the cache updater.
    if (query.state.fetchStatus !== 'idle') await query.promise;
    if (signal?.aborted) return;
    const data = client.getQueryData<MessageWindows>(query.queryKey);
    const tail = data?.pages.at(-1);
    if (!tail || tail.newest_id === null) {
      await client.invalidateQueries({ queryKey: query.queryKey, exact: true }, { throwOnError: true });
      return;
    }
    // A deep-linked window already has a newer-page affordance. Do not download the gap.
    if (tail.has_newer) return;

    const fromId = tail.newest_id;
    let afterId = fromId;
    const additions: Message[] = [];
    while (true) {
      const page = await listMessages(sessionId, { after_id: afterId }, signal);
      additions.push(...page.items);
      if (!page.has_newer) break;
      if (page.newest_id === null || page.newest_id <= afterId) {
        throw new Error('Message refresh pagination did not advance');
      }
      afterId = page.newest_id;
    }
    if (signal?.aborted || additions.length === 0) return;

    // Paging can also begin while the tail request is in flight. Let it commit first so its
    // captured pages cannot overwrite this update when it resolves later.
    if (query.state.fetchStatus !== 'idle') await query.promise;
    if (signal?.aborted) return;

    client.setQueryData<MessageWindows>(query.queryKey, (current) => {
      const last = current?.pages.at(-1);
      // A replacement fetch may have completed meanwhile. Never overwrite its newer snapshot.
      if (!current || !last || last.newest_id !== fromId || last.has_newer) return current;
      const pages = current.pages.slice(0, -1);
      const pageParams = current.pageParams.slice();
      const items = [...last.items, ...additions];
      // Fill the existing tail before adding pages, so a short turn does not add a whole page.
      for (let offset = 0; offset < items.length; offset += MESSAGE_PAGE_SIZE) {
        const chunk = items.slice(offset, offset + MESSAGE_PAGE_SIZE);
        if (offset > 0) pageParams.push({ after_id: items[offset - 1]!.id });
        pages.push({
          items: chunk,
          oldest_id: chunk[0]!.id,
          newest_id: chunk[chunk.length - 1]!.id,
          has_older: offset > 0 || last.has_older,
          has_newer: offset + chunk.length < items.length,
        });
      }
      return { pages, pageParams };
    });
  }));
  await client.invalidateQueries({ queryKey: queryKeys.messages.children(sessionId), exact: true });
}

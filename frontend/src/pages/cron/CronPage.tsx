import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import { cronEventsUrl } from '../../api/cron';
import { queryKeys } from '../../api/queryKeys';
import { CronList } from './CronList';
import classes from './CronPage.module.css';

/**
 * Scheduled tasks: master-detail layout, live-updated via `/api/cron/events` SSE (BUILD-SPEC
 * §5.4 "live updates pushed from the server, not polled"). The stream only ever carries a
 * change signal (`jobs-changed`) — the payload itself is refetched through TanStack Query so a
 * single source of truth (the query cache) backs both the list and detail panes.
 */
export default function CronPage() {
  const { jobId } = useParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource(cronEventsUrl());
    source.addEventListener('jobs-changed', () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cron.all });
    });
    return () => source.close();
  }, [queryClient]);

  return (
    <div className={classes.root} data-has-selection={jobId ? true : undefined}>
      <aside className={classes.list} aria-label="Scheduled tasks">
        <CronList selectedId={jobId} />
      </aside>
      <section className={classes.detail}>
        <Outlet />
      </section>
    </div>
  );
}

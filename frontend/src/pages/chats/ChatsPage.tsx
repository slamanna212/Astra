import { useCallback, useLayoutEffect, useRef } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { resetEdgeSwipe, useEdgeSwipeBack } from '../../hooks/useEdgeSwipeBack';
import classes from './ChatsPage.module.css';
import { SessionList } from './SessionList';

export default function ChatsPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const back = useCallback(() => void navigate('/chats'), [navigate]);
  // On a phone the open chat covers the list; swiping in from the left edge goes back to it.
  useEdgeSwipeBack(detailRef, rootRef, { enabled: Boolean(sessionId), onBack: back });
  // Once the route has changed, put the swiped-away panel back for next time.
  useLayoutEffect(() => resetEdgeSwipe(detailRef.current, rootRef.current), [sessionId]);
  return (
    <div ref={rootRef} className={classes.root} data-has-selection={sessionId ? true : undefined}>
      <aside className={classes.list} aria-label="Sessions">
        <SessionList selectedId={sessionId} />
      </aside>
      <section ref={detailRef} className={classes.detail}>
        <Outlet />
      </section>
    </div>
  );
}

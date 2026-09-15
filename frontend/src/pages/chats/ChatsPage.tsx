import { Outlet, useParams } from 'react-router';
import classes from './ChatsPage.module.css';
import { SessionList } from './SessionList';

export default function ChatsPage() {
  const { sessionId } = useParams();
  return (
    <div className={classes.root} data-has-selection={sessionId ? true : undefined}>
      <aside className={classes.list} aria-label="Sessions">
        <SessionList selectedId={sessionId} />
      </aside>
      <section className={classes.detail}>
        <Outlet />
      </section>
    </div>
  );
}

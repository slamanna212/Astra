import { useParams } from 'react-router';
import { Outlet } from 'react-router';
import { SkillList } from './SkillList';
import classes from './SkillsPage.module.css';

export default function SkillsPage() {
  const { category, name } = useParams();
  const hasSelection = !!name;
  return (
    <div className={classes.root} data-has-selection={hasSelection ? true : undefined}>
      <aside className={classes.list} aria-label="Skills">
        <SkillList selectedCategory={category ?? null} selectedName={name ?? null} />
      </aside>
      <section className={classes.detail}>
        <Outlet />
      </section>
    </div>
  );
}

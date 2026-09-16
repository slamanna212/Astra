import { useSearchParams } from 'react-router';
import { FileBrowser } from './FileBrowser';
import { FilePreview } from './FilePreview';
import classes from './FilesPage.module.css';

/**
 * Files browses ONLY the workspace root (never HERMES_HOME) — browse/preview/download/upload
 * only this phase, no edit/rename/delete/create-directory. See backend/src/astra/files.py for
 * the security model.
 *
 * URL state: `dir` is the current directory (workspace-relative, "" for the root); `file` is the
 * currently previewed file's path, if any. Both are plain query params so a listing/preview is
 * linkable and survives a refresh.
 */
export default function FilesPage() {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') ?? '';
  const selected = params.get('file');

  const openDirectory = (path: string) => {
    const next = new URLSearchParams();
    if (path) next.set('dir', path);
    setParams(next);
  };

  const selectFile = (path: string) => {
    const next = new URLSearchParams(params);
    next.set('file', path);
    setParams(next);
  };

  const closePreview = () => {
    const next = new URLSearchParams(params);
    next.delete('file');
    setParams(next);
  };

  return (
    <div className={classes.root} data-has-selection={selected ? true : undefined}>
      <aside className={classes.browser} aria-label="Workspace files">
        <FileBrowser dir={dir} selected={selected} onOpenDirectory={openDirectory} onSelectFile={selectFile} />
      </aside>
      <section className={classes.preview}>
        <FilePreview path={selected} onClose={closePreview} />
      </section>
    </div>
  );
}

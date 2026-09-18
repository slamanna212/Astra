import { Center, Loader } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { getTerminalInfo } from '../../api/terminal';
import { ResizeHandle } from '../../components/ResizeHandle';
import { useResizable } from '../../hooks/useResizable';
import { FileBrowser } from './FileBrowser';
import { FilePreview } from './FilePreview';
import classes from './FilesPage.module.css';

// xterm.js is only fetched once someone actually opens the terminal.
const TerminalPanel = lazy(() => import('./TerminalPanel'));

const TERMINAL_OPEN_KEY = 'astra.files.terminal-open.v1';
const REM = 16;

function readTerminalOpen(): boolean {
  try {
    return localStorage.getItem(TERMINAL_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Files browses ONLY the workspace root (never HERMES_HOME) — browse/preview/download/upload
 * only this phase, no edit/rename/delete/create-directory. See backend/src/astra/files.py for
 * the security model.
 *
 * URL state: `dir` is the current directory (workspace-relative, "" for the root); `file` is the
 * currently previewed file's path, if any. Both are plain query params so a listing/preview is
 * linkable and survives a refresh.
 *
 * Layout: browser | preview split with a draggable divider, plus an optional bottom terminal
 * panel (only when the server enables it). Panel sizes are per-browser UI state in localStorage.
 */
export default function FilesPage() {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') ?? '';
  const selected = params.get('file');

  const browser = useResizable({
    storageKey: 'astra.files.browser-width.v1',
    axis: 'x',
    initial: 26 * REM,
    min: 16 * REM,
    max: () => Math.max(16 * REM, window.innerWidth * 0.7),
  });
  const terminalSize = useResizable({
    storageKey: 'astra.files.terminal-height.v1',
    axis: 'y',
    inverted: true,
    initial: 280,
    min: 120,
    max: () => Math.max(120, window.innerHeight * 0.8),
  });

  const terminalInfo = useQuery({
    queryKey: queryKeys.terminal,
    queryFn: ({ signal }) => getTerminalInfo(signal),
    staleTime: Infinity,
  });
  const terminalEnabled = terminalInfo.data?.enabled === true;
  const [terminalOpen, setTerminalOpen] = useState(readTerminalOpen);
  const setTerminalOpenPersisted = (open: boolean) => {
    setTerminalOpen(open);
    try {
      localStorage.setItem(TERMINAL_OPEN_KEY, open ? '1' : '0');
    } catch {
      // not persisted; fine
    }
  };
  const showTerminal = terminalEnabled && terminalOpen;

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
    <div className={classes.page} data-dragging={browser.dragging || terminalSize.dragging || undefined}>
      <div className={classes.root} data-has-selection={selected ? true : undefined}>
        <aside className={classes.browser} aria-label="Workspace files" style={{ width: browser.size }}>
          <FileBrowser
            dir={dir}
            selected={selected}
            onOpenDirectory={openDirectory}
            onSelectFile={selectFile}
            terminal={terminalEnabled ? { open: terminalOpen, onToggle: () => setTerminalOpenPersisted(!terminalOpen) } : undefined}
          />
        </aside>
        <ResizeHandle {...browser.handleProps} label="Resize file browser and preview" className={classes.splitHandle} />
        <section className={classes.preview}>
          <FilePreview path={selected} onClose={closePreview} />
        </section>
      </div>
      {showTerminal && (
        <>
          <ResizeHandle {...terminalSize.handleProps} label="Resize terminal" />
          <section className={classes.terminal} aria-label="Workspace terminal" style={{ height: terminalSize.size }}>
            <Suspense
              fallback={
                <Center h="100%">
                  <Loader size="sm" />
                </Center>
              }
            >
              <TerminalPanel onClose={() => setTerminalOpenPersisted(false)} />
            </Suspense>
          </section>
        </>
      )}
    </div>
  );
}

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../../api/types';
import { jsonResponse, render } from '../../test/render';
import { FILE_ROW_HEIGHT, FileBrowser } from './FileBrowser';

function makeEntry(i: number): FileEntry {
  return {
    name: `file-${i}.txt`,
    path: `file-${i}.txt`,
    is_dir: false,
    is_symlink: false,
    size: i * 10,
    mtime: Date.now() / 1000 - i,
    mime: 'text/plain',
  };
}

const VIEWPORT_HEIGHT = 640;

describe('FileBrowser', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(360);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders only a window of a 500-entry directory (virtualized)', async () => {
    const entries = Array.from({ length: 500 }, (_, i) => makeEntry(i));
    fetchMock.mockImplementation(async () => jsonResponse({ path: '', entries, truncated: false }));

    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);

    const rows = await screen.findAllByTestId('file-row');
    const visibleRows = Math.ceil(VIEWPORT_HEIGHT / FILE_ROW_HEIGHT);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(visibleRows + 2 * 12 + 2);
    expect(rows.length).toBeLessThan(500);

    const list = screen.getByRole('list', { name: 'Files' });
    expect(list).toHaveStyle({ height: `${500 * FILE_ROW_HEIGHT}px` });
  });

  it('shows an empty state for an empty directory', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ path: '', entries: [], truncated: false }));
    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    expect(await screen.findByText('This directory is empty.')).toBeInTheDocument();
  });

  it('clicking a directory row calls onOpenDirectory, not onSelectFile', async () => {
    const entries: FileEntry[] = [
      { name: 'notes', path: 'notes', is_dir: true, is_symlink: false, size: 0, mtime: 0, mime: null },
    ];
    fetchMock.mockImplementation(async () => jsonResponse({ path: '', entries, truncated: false }));
    const onOpenDirectory = vi.fn();
    const onSelectFile = vi.fn();
    const user = userEvent.setup();

    render(<FileBrowser dir="" selected={null} onOpenDirectory={onOpenDirectory} onSelectFile={onSelectFile} />);
    const row = await screen.findByTestId('file-row');
    await user.click(row);

    expect(onOpenDirectory).toHaveBeenCalledWith('notes');
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('disables symlinked entries so they cannot be opened', async () => {
    const entries: FileEntry[] = [
      { name: 'escape', path: 'escape', is_dir: false, is_symlink: true, size: 0, mtime: 0, mime: null },
    ];
    fetchMock.mockImplementation(async () => jsonResponse({ path: '', entries, truncated: false }));

    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    const row = await screen.findByTestId('file-row');
    expect(row).toBeDisabled();
  });

  it('shows a truncation notice when the backend caps the listing', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i));
    fetchMock.mockImplementation(async () => jsonResponse({ path: '', entries, truncated: true }));
    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    expect(await screen.findByText(/has more/)).toBeInTheDocument();
  });
});

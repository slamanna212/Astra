import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '../../api/types';
import { jsonResponse, render } from '../../test/render';
import { FileBrowser } from './FileBrowser';

const CLEAN: GitStatus = {
  repo: true,
  branch: 'main',
  head: 'abc1234',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  dirty: false,
};

function mockApi(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, git: GitStatus) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/files/git')) return jsonResponse(git);
    return jsonResponse({ path: '', entries: [], truncated: false });
  });
}

describe('Files git badge', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('shows the branch of a clean repo', async () => {
    mockApi(fetchMock, CLEAN);
    render(<FileBrowser dir="proj" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    const badge = await screen.findByTestId('git-badge');
    expect(badge).toHaveTextContent('main');
    expect(badge).not.toHaveTextContent('●');
    expect(badge).toHaveAccessibleName(/Working tree clean/);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/files/git?path=proj'), expect.anything());
  });

  it('shows dirty count and ahead/behind', async () => {
    mockApi(fetchMock, { ...CLEAN, dirty: true, unstaged: 2, untracked: 1, ahead: 3, behind: 1 });
    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    const badge = await screen.findByTestId('git-badge');
    expect(badge).toHaveTextContent('● 3');
    expect(badge).toHaveTextContent('↑3');
    expect(badge).toHaveTextContent('↓1');
    expect(badge).toHaveAccessibleName(/2 files modified/);
  });

  it('renders nothing outside a repo', async () => {
    mockApi(fetchMock, { ...CLEAN, repo: false, branch: null });
    render(<FileBrowser dir="" selected={null} onOpenDirectory={() => {}} onSelectFile={() => {}} />);
    await screen.findByText('This directory is empty.');
    expect(screen.queryByTestId('git-badge')).toBeNull();
  });
});

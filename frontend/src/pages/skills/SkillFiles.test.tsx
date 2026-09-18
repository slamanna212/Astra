import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import { getSkillFileContent } from '../../api/skills';
import { SkillFiles } from './SkillFiles';

vi.mock('../../api/skills', () => ({
  getSkillFileContent: vi.fn(async (_category: string | null, _name: string, path: string) => ({
    meta: { path, name: path.split('/').at(-1) ?? path, size: 12, mtime: 1, mime: 'text/markdown' },
    content: `# ${path}`,
    truncated: false,
    previewable: true,
    reason: null,
  })),
  skillFileOpenUrl: vi.fn((_category: string | null, _name: string, path: string) => `/open?path=${encodeURIComponent(path)}`),
}));

describe('SkillFiles', () => {
  it('groups files and loads the selected file preview', async () => {
    const user = userEvent.setup();
    render(
      <SkillFiles
        category="development"
        name="debugger"
        files={['references/guide.md', 'scripts/check.py', 'LICENSE']}
      />,
    );

    expect(screen.getByText('references')).toBeInTheDocument();
    expect(screen.getByText('scripts')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'references/guide.md' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /scripts\/check\.py/i }));
    await waitFor(() => expect(getSkillFileContent).toHaveBeenLastCalledWith(
      'development',
      'debugger',
      'scripts/check.py',
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText('# scripts/check.py')).toBeInTheDocument();
  });
});

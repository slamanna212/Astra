import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../test/render';
import { CODE_PAGE_CHARS } from '../lib/highlightWindow';
import { highlightClient } from '../lib/highlightClient';
import CodePreview from './CodePreview';

vi.mock('../lib/highlightClient', () => ({ highlightClient: { request: vi.fn() } }));
beforeEach(() => vi.mocked(highlightClient.request).mockImplementation(() => ({ promise: Promise.resolve(null), cancel: vi.fn() })));

describe('CodePreview', () => {
  it('bounds the displayed source, pages through all content, and copies the full code', async () => {
    const user = userEvent.setup();
    const code = `${'x'.repeat(CODE_PAGE_CHARS)}last page`;
    render(<CodePreview code={code} language="js" />);
    expect(screen.getByLabelText('Code preview').textContent).toBe('x'.repeat(CODE_PAGE_CHARS));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Code preview').textContent).toBe('last page');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await navigator.clipboard.readText()).toBe(code);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('cancels old work and never replaces newer source with stale highlights', async () => {
    const pending: { resolve: (html: string) => void; cancel: ReturnType<typeof vi.fn> }[] = [];
    vi.mocked(highlightClient.request).mockImplementation(() => {
      const cancel = vi.fn();
      const promise = new Promise<string>((resolve) => pending.push({ resolve, cancel }));
      return { promise, cancel };
    });
    const { rerender, unmount } = render(<CodePreview code="old" language="js" />);
    rerender(<CodePreview code="new" language="js" />);
    expect(pending[0]!.cancel).toHaveBeenCalledOnce();
    await act(async () => pending[0]!.resolve('<span class="hljs-string">old</span>'));
    expect(screen.getByLabelText('Code preview').textContent).toBe('new');
    await act(async () => pending[1]!.resolve('<span class="hljs-string">new</span>'));
    expect(screen.getByLabelText('Code preview').querySelector('.hljs-string')).toHaveTextContent('new');
    unmount();
    expect(pending[1]!.cancel).toHaveBeenCalledOnce();
  });
});

import { render as testingLibraryRender, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it } from 'vitest';
import { theme } from '../theme';
import { Markdown } from './Markdown';

function render(ui: React.ReactNode) {
  return testingLibraryRender(<MantineProvider theme={theme} env="test">{ui}</MantineProvider>);
}

describe('Markdown', () => {
  it('renders basic markdown formatting', () => {
    render(<Markdown>{'**bold** and *italic*'}</Markdown>);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
  });

  it('never renders raw HTML embedded in the source (no rehype-raw)', () => {
    const { container } = render(<Markdown>{'before <script>window.__pwned = true;</script> after'}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The literal tag text is escaped/shown as text, not executed or dropped silently.
    expect(container.textContent).toContain('<script>');
  });

  it('does not render a raw <img onerror> as an actual element', () => {
    const { container } = render(<Markdown>{'<img src=x onerror="window.__pwned2=true">'}</Markdown>);
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned2?: boolean }).__pwned2).toBeUndefined();
  });

  it('renders fenced code blocks as a code element', () => {
    render(<Markdown>{'```js\nconsole.log(1)\n```'}</Markdown>);
    expect(screen.getByText(/console\.log\(1\)/)).toBeInTheDocument();
  });

  it('opens links in a new tab with a safe rel', () => {
    render(<Markdown>{'[link](https://example.com)'}</Markdown>);
    const anchor = screen.getByRole('link', { name: 'link' });
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor.getAttribute('rel')).toContain('noopener');
  });
});

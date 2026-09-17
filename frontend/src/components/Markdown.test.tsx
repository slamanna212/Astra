import { render as testingLibraryRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { Markdown } from './Markdown';

const renderMermaid = vi.fn(async () => ({ svg: '<svg data-testid="rendered-mermaid"></svg>' }));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: renderMermaid,
  },
}));

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

  it.each([
    ['without a language', '```\nplain text\n```'],
    ['with an unknown language', '```not-a-real-language\nplain text\n```'],
  ])('highlights fenced code %s without crashing', async (_description, markdown) => {
    render(<Markdown codeHighlight>{markdown}</Markdown>);
    expect(await screen.findByText('plain text')).toBeInTheDocument();
  });

  it('copies fenced code and reports Copied feedback', async () => {
    const user = userEvent.setup();
    render(<Markdown codeHighlight>{'```js\nconsole.log(1)\n```'}</Markdown>);

    const copyButton = await screen.findByRole('button', { name: 'Copy code' });
    await user.click(copyButton);

    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('console.log(1)');
  });

  it('renders Mermaid fenced blocks as diagrams', async () => {
    render(<Markdown>{'```mermaid\ngraph TD\n  A --> B\n```'}</Markdown>);

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toContainElement(
      screen.getByTestId('rendered-mermaid'),
    );
    expect(renderMermaid).toHaveBeenCalledWith(expect.any(String), 'graph TD\n  A --> B');
  });

  it('shows the source when a Mermaid diagram is invalid', async () => {
    renderMermaid.mockRejectedValueOnce(new Error('Parse error'));
    render(<Markdown codeHighlight>{'```mermaid\nnot a diagram\n```'}</Markdown>);

    expect(await screen.findByText('Invalid Mermaid diagram')).toBeInTheDocument();
    expect(screen.getByText('not a diagram')).toBeInTheDocument();
  });

  it('renders inline and display math with KaTeX', () => {
    const { container } = render(<Markdown>{'Inline $E = mc^2$\n\n$$\n\\int_0^1 x^2 dx\n$$'}</Markdown>);

    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex-display')).toBeInTheDocument();
  });

  it('opens links in a new tab with a safe rel', () => {
    render(<Markdown>{'[link](https://example.com)'}</Markdown>);
    const anchor = screen.getByRole('link', { name: 'link' });
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor.getAttribute('rel')).toContain('noopener');
  });
});

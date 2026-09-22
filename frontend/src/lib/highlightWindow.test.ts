import { describe, expect, it } from 'vitest';
import { CODE_PAGE_CHARS, CODE_PAGE_LINES, codePages, sliceHighlightedHtml } from './highlightWindow';
import { highlightWindow } from './highlightSyntax';

describe('bounded code pages', () => {
  it.each([
    '',
    'line\n'.repeat(1000),
    'x'.repeat(1024 * 1024),
    `${'x'.repeat(CODE_PAGE_CHARS - 1)}😀tail`,
    `short\n${'x'.repeat(CODE_PAGE_CHARS * 2)}\nlast`,
  ])('preserves all source text within page limits', (code) => {
    const pages = codePages(code);
    expect(pages.map(({ start, end }) => code.slice(start, end)).join('')).toBe(code);
    for (const { start, end } of pages) {
      const text = code.slice(start, end);
      expect(text.length).toBeLessThanOrEqual(CODE_PAGE_CHARS);
      expect((text.match(/\n/g) ?? []).length).toBeLessThanOrEqual(CODE_PAGE_LINES);
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text)).toBe(false);
    }
  });
});

describe('highlighted windows', () => {
  it('reopens nested scopes and handles escaped characters at arbitrary boundaries', () => {
    const html = '<span class="hljs-string">a&lt;<span class="hljs-subst">&amp;b</span>c&gt;d</span>';
    const text = 'a<&bc>d';
    for (let start = 0; start < text.length; start++) {
      for (let end = start + 1; end <= text.length; end++) {
        const fragment = sliceHighlightedHtml(html, start, end);
        const el = document.createElement('div');
        el.innerHTML = fragment;
        expect(el.textContent).toBe(text.slice(start, end));
        expect(el.innerHTML).toBe(fragment);
      }
    }
  });

  it('preserves multiline syntax across pages and escapes source HTML', () => {
    const source = `/* start\n${'comment <script>alert("x")</script> & text\n'.repeat(250)}end */\nconst n = 1;`;
    const pages = codePages(source);
    const text = [];
    for (const page of pages) {
      const el = document.createElement('div');
      el.innerHTML = highlightWindow(source, 'js', page.start, page.end)!;
      expect(el.querySelector('script')).toBeNull();
      expect(el.querySelector('.hljs-comment')).not.toBeNull();
      text.push(el.textContent);
    }
    expect(text.join('')).toBe(source);
  });

  it('returns a bounded fragment for a long single line and handles unknown languages', () => {
    const source = 'const value = "test"; '.repeat(50_000);
    const html = highlightWindow(source, 'javascript', 0, CODE_PAGE_CHARS)!;
    expect(html.length).toBeLessThanOrEqual(256 * 1024);
    const el = document.createElement('div');
    el.innerHTML = html;
    expect(el.textContent).toBe(source.slice(0, CODE_PAGE_CHARS));
    expect(highlightWindow(source, 'unknown-language', 0, 100)).toBeNull();
  });
});

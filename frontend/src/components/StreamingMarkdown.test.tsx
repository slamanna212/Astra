import { describe, expect, it } from 'vitest';
import { render } from '../test/render';
import { StreamingMarkdown } from './StreamingMarkdown';

describe('StreamingMarkdown', () => {
  it('marks only newly appended text as new', () => {
    const view = render(<StreamingMarkdown text="Hello there" />);
    const fresh = () => Array.from(view.container.querySelectorAll('[data-new]')).map((el) => el.textContent);
    expect(fresh()).toEqual(['Hello there']);

    view.rerender(<StreamingMarkdown text="Hello there, friend" />);
    expect(view.container.textContent).toContain('Hello there, friend');
    expect(fresh()).toEqual(['Hello there', ', friend']);
  });

  it('keeps earlier chunks in their own spans as the text grows', () => {
    const view = render(<StreamingMarkdown text="a" />);
    for (const next of ['ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh']) {
      view.rerender(<StreamingMarkdown text={next} />);
    }
    const spans = Array.from(view.container.querySelectorAll('p span')).map((el) => el.textContent);
    expect(spans).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    // Only the newest chunks stay marked, so a remount cannot re-fade the whole paragraph.
    expect(view.container.querySelectorAll('[data-new]').length).toBe(6);
  });

  it('leaves code blocks unwrapped', () => {
    const view = render(<StreamingMarkdown text={'```\nconst a = 1\n'} />);
    view.rerender(<StreamingMarkdown text={'```\nconst a = 1\nconst b = 2\n'} />);
    expect(view.container.querySelector('pre [data-new]')).toBeNull();
    expect(view.container.querySelector('pre')?.textContent).toContain('const b = 2');
  });
});

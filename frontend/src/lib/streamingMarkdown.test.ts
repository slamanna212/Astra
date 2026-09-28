import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdown } from './streamingMarkdown';

describe('splitStreamingMarkdown', () => {
  it('keeps a single block entirely in the tail', () => {
    expect(splitStreamingMarkdown('Hello wor')).toEqual({ stable: '', tail: 'Hello wor' });
  });

  it('splits at the start of the block being written', () => {
    expect(splitStreamingMarkdown('First para.\n\nSecond pa')).toEqual({ stable: 'First para.', tail: 'Second pa' });
  });

  it('never splits inside an open code fence', () => {
    const text = 'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;';
    expect(splitStreamingMarkdown(text)).toEqual({ stable: 'Intro.', tail: '```ts\nconst a = 1;\n\nconst b = 2;' });
  });

  it('treats a closed fence as finished', () => {
    const text = '```\ncode\n\nmore\n```\n\nAfter';
    expect(splitStreamingMarkdown(text)).toEqual({ stable: '```\ncode\n\nmore\n```', tail: 'After' });
  });

  it('keeps a trailing blank line with the tail until the next block starts', () => {
    expect(splitStreamingMarkdown('Done.\n\n')).toEqual({ stable: '', tail: 'Done.\n\n' });
  });
});

import { describe, expect, it } from 'vitest';
import { toolArgumentPreview } from './toolDisplay';

describe('toolArgumentPreview', () => {
  it('prefers a primary key, then any string, then the first entry of a string list', () => {
    expect(toolArgumentPreview({ query: 'new games', limit: 5 })).toBe('new games');
    expect(toolArgumentPreview('{"urls": ["https://a.example/x"]}')).toBe('https://a.example/x');
    expect(toolArgumentPreview({ urls: ['https://a.example/x', 'https://b.example/y', 'https://c.example/z'] })).toBe('https://a.example/x +2');
    expect(toolArgumentPreview({ ids: [1, 2] })).toBe('{ "ids": [ 1, 2 ] }');
  });
});

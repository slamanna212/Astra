import { describe, expect, it } from 'vitest';
import { SNIPPET_END, SNIPPET_START } from '../api/types';
import { parseSnippet } from './snippet';

describe('parseSnippet', () => {
  it('returns a single unmarked part for plain text', () => {
    expect(parseSnippet('hello world')).toEqual([{ text: 'hello world', marked: false }]);
  });

  it('splits marked runs out of the surrounding text', () => {
    const input = `the ${SNIPPET_START}quick${SNIPPET_END} brown ${SNIPPET_START}fox${SNIPPET_END}`;
    expect(parseSnippet(input)).toEqual([
      { text: 'the ', marked: false },
      { text: 'quick', marked: true },
      { text: ' brown ', marked: false },
      { text: 'fox', marked: true },
    ]);
  });

  it('handles a marked run at the very start or end', () => {
    const input = `${SNIPPET_START}start${SNIPPET_END} middle ${SNIPPET_START}end${SNIPPET_END}`;
    const parts = parseSnippet(input);
    expect(parts[0]).toEqual({ text: 'start', marked: true });
    expect(parts.at(-1)).toEqual({ text: 'end', marked: true });
  });

  it('treats an unterminated start marker as plain text rather than dropping it', () => {
    const input = `before ${SNIPPET_START}unterminated`;
    const parts = parseSnippet(input);
    expect(parts.some((p) => p.marked)).toBe(false);
    expect(parts.map((p) => p.text).join('')).toBe('before unterminated');
  });

  it('returns an empty array for an empty string', () => {
    expect(parseSnippet('')).toEqual([]);
  });

  it('never needs raw HTML — marked text is plain string content', () => {
    const parts = parseSnippet(`${SNIPPET_START}<script>alert(1)</script>${SNIPPET_END}`);
    expect(parts).toEqual([{ text: '<script>alert(1)</script>', marked: true }]);
  });
});

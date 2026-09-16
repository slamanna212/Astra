import { SNIPPET_END, SNIPPET_START } from '../api/types';

export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * Split a backend snippet on the sentinel markers into plain/marked runs, so the caller can
 * render `<mark>` for the marked runs without ever using `dangerouslySetInnerHTML`.
 */
export function parseSnippet(snippet: string): SnippetPart[] {
  if (!snippet) return [];
  const parts: SnippetPart[] = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    const start = snippet.indexOf(SNIPPET_START, cursor);
    if (start < 0) {
      parts.push({ text: snippet.slice(cursor), marked: false });
      break;
    }
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), marked: false });
    const end = snippet.indexOf(SNIPPET_END, start + SNIPPET_START.length);
    if (end < 0) {
      // Unterminated marker: treat the rest as plain text rather than dropping it.
      parts.push({ text: snippet.slice(start + SNIPPET_START.length), marked: false });
      break;
    }
    parts.push({ text: snippet.slice(start + SNIPPET_START.length, end), marked: true });
    cursor = end + SNIPPET_END.length;
  }
  return parts;
}

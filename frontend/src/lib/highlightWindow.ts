export const CODE_PAGE_CHARS = 16_384;
export const CODE_PAGE_LINES = 200;

export interface CodePage { start: number; end: number }

/** Bound both line count and character count, including minified files with one enormous line. */
export function codePages(code: string): CodePage[] {
  const pages: CodePage[] = [];
  for (let start = 0; start < code.length;) {
    let end = Math.min(start + CODE_PAGE_CHARS, code.length);
    let lineEnd = start;
    let lines = 0;
    for (let next = code.indexOf('\n', start); next >= 0 && next < end; next = code.indexOf('\n', next + 1)) {
      lineEnd = next + 1;
      if (++lines === CODE_PAGE_LINES) {
        end = lineEnd;
        break;
      }
    }
    if (end < code.length && lineEnd > start) end = lineEnd;
    // Do not divide a Unicode surrogate pair at the character limit.
    if (end < code.length && /[\uD800-\uDBFF]/.test(code[end - 1]!)) end -= 1;
    pages.push({ start, end });
    start = end;
  }
  return pages.length ? pages : [{ start: 0, end: 0 }];
}

/** Slice highlight.js markup by source offsets, reopening spans that cross page boundaries.
 * Only the worker's escaped highlight.js output is accepted here, never source HTML. */
export function sliceHighlightedHtml(html: string, start: number, end: number): string {
  const stack: string[] = [];
  const parts: string[] = [];
  let offset = 0;
  let started = false;
  for (const match of html.matchAll(/<[^>]*>|&(?:#\w+|\w+);|[^<&]+/g)) {
    const token = match[0];
    if (token.startsWith('<')) {
      if (token === '</span>') stack.pop();
      else if (/^<span class="[\w ._-]+">$/.test(token)) stack.push(token);
      else throw new Error('Unexpected highlight markup');
      if (started) parts.push(token);
      continue;
    }
    const entity = token.startsWith('&');
    const length = entity ? 1 : token.length;
    if (offset < end && offset + length > start) {
      if (!started) {
        parts.push(...stack);
        started = true;
      }
      parts.push(entity ? token : token.slice(Math.max(0, start - offset), end - offset));
    }
    offset += length;
    if (offset >= end) break;
  }
  if (started) parts.push('</span>'.repeat(stack.length));
  return parts.join('');
}

/**
 * Marks text that just streamed in so it can fade in instead of popping.
 *
 * `starts` are source offsets (into the markdown being rendered) where each appended chunk began,
 * oldest first. Every text node is split at those offsets and each piece is wrapped in its own
 * <span>, so as the text grows the earlier spans keep their place and React never moves content
 * between elements. Only the newest `freshCount` chunks carry `data-new`; an older span that gets
 * remounted (when the markdown structure changes) therefore does not fade in a second time.
 *
 * Code blocks and KaTeX output are left untouched.
 */

interface HastPoint {
  offset?: number;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: HastPoint; end: HastPoint };
}

function skip(node: HastNode): boolean {
  if (node.type !== 'element') return false;
  if (node.tagName === 'pre') return true;
  const className = node.properties?.className;
  return Array.isArray(className) && className.some((name) => typeof name === 'string' && name.startsWith('katex'));
}

function chunkIndex(starts: number[], offset: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i]! <= offset) index = i;
    else break;
  }
  return index;
}

function splitText(node: HastNode, starts: number[], freshFrom: number): HastNode[] {
  const value = node.value ?? '';
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  // Escapes and entities make source and rendered text differ in length; such a node is left as is.
  if (start === undefined || end === undefined || end - start !== value.length || value.length === 0) return [node];
  const cuts = [start, ...starts.filter((offset) => offset > start && offset < end), end];
  const pieces: HastNode[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const from = cuts[i]!;
    const text = value.slice(from - start, cuts[i + 1]! - start);
    const fresh = chunkIndex(starts, from) >= freshFrom;
    pieces.push({
      type: 'element',
      tagName: 'span',
      properties: fresh ? { dataNew: '' } : {},
      children: [{ type: 'text', value: text }],
    });
  }
  return pieces;
}

export function rehypeFreshText(starts: number[], freshCount = 6) {
  const freshFrom = Math.max(0, starts.length - freshCount);
  return () => (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (!node.children || skip(node)) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text') next.push(...splitText(child, starts, freshFrom));
        else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

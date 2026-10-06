import type { List, PhrasingContent, Root, RootContent, Table } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { ToolStatus } from './turnBlocks';

/**
 * Layout for the PDF export: turns markdown and plain text into fixed rows of styled runs that
 * the PDF writer draws and paginates. Everything here works in PDF points.
 */

export type PdfFont = 'regular' | 'bold' | 'italic' | 'mono';
export type PdfInk = 'text' | 'body' | 'muted' | 'teal' | 'sand';

export interface PdfRun {
  text: string;
  font: PdfFont;
  ink: PdfInk;
}

export type PdfLine =
  | {
      kind: 'text';
      runs: PdfRun[];
      size: number;
      /** Offset of the text from the content edge (list nesting, quotes). */
      indent: number;
      /** List marker drawn at `markerIndent`, on an item's first line only. */
      marker?: { text: string | null; indent: number };
      /** Offsets of blockquote bars to the left of the text. */
      quoteBars?: number[];
    }
  | { kind: 'code'; text: string; indent: number; box: string }
  | { kind: 'cells'; indent: number; cells: { x: number; runs: PdfRun[] }[]; rule: 'header' | 'row' | null }
  | { kind: 'rule'; indent: number }
  | { kind: 'gap'; height: number }
  | { kind: 'header'; box: string; summary: string; meta: string; failed: number }
  | { kind: 'step'; box: string; title: string; detail: string; mono: boolean; status: ToolStatus | null };

export const BODY_SIZE = 8.5;
export const CODE_SIZE = 7.2;
const INLINE_CODE_SCALE = 0.9;

export function lineHeight(line: PdfLine): number {
  if (line.kind === 'gap') return line.height;
  if (line.kind === 'text' && line.size > 10) return line.size + 5;
  return 12;
}

// PDF's built-in fonts use Windows-1252; keep to printable ASCII, mapping common punctuation and
// replacing anything else rather than emitting a corrupt document.
export function pdfSafe(text: string): string {
  const normalized = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/\u00b7/g, '/')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u21d2/g, '=>')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u2260/g, '!=')
    .replace(/\u00d7/g, 'x')
    .replace(/[\u2713\u2714\u2705]/g, '[x]')
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return Array.from(normalized, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) ? character : '?';
  }).join('');
}

// Standard Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Advance width of already pdfSafe text. Oblique shares Helvetica's metrics; Courier is 0.6em. */
export function textWidth(text: string, size: number, font: PdfFont): number {
  if (font === 'mono') return text.length * 0.6 * size;
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    units += table[code - 32] ?? 556;
  }
  return (units / 1000) * size;
}

/** Clip a single line to fit `width` points, with a trailing ellipsis. */
export function fitText(text: string, width: number, size: number, font: PdfFont): string {
  if (textWidth(text, size, font) <= width) return text;
  let end = text.length;
  while (end > 0 && textWidth(`${text.slice(0, end)}...`, size, font) > width) end -= 1;
  return end > 0 ? `${text.slice(0, end).trimEnd()}...` : '';
}

export function runSize(run: PdfRun, size: number): number {
  return run.font === 'mono' ? size * INLINE_CODE_SCALE : size;
}

export function runsWidth(runs: PdfRun[], size: number): number {
  return runs.reduce((sum, run) => sum + textWidth(run.text, runSize(run, size), run.font), 0);
}

function sameStyle(a: PdfRun, b: PdfRun): boolean {
  return a.font === b.font && a.ink === b.ink;
}

/** Greedy word wrap of styled runs; `\n` inside a run forces a break. Words wider than a line are split. */
export function wrapRuns(runs: PdfRun[], width: number, size: number): PdfRun[][] {
  const lines: PdfRun[][] = [];
  let line: PdfRun[] = [];
  let used = 0;
  let pendingSpace: PdfRun | null = null;
  const append = (run: PdfRun) => {
    const last = line.at(-1);
    if (last && sameStyle(last, run)) line[line.length - 1] = { ...last, text: last.text + run.text };
    else line.push(run);
  };
  const flush = () => {
    lines.push(line);
    line = [];
    used = 0;
    pendingSpace = null;
  };
  for (const run of runs) {
    const pieces = run.text.split(/(\n|[ \t]+)/);
    for (const piece of pieces) {
      if (!piece) continue;
      if (piece === '\n') {
        flush();
        continue;
      }
      const pieceSize = runSize(run, size);
      if (/^[ \t]+$/.test(piece)) {
        if (line.length) pendingSpace = { ...run, text: ' ' };
        continue;
      }
      let word = piece;
      const spaceWidth = pendingSpace ? textWidth(' ', pieceSize, run.font) : 0;
      let wordWidth = textWidth(word, pieceSize, run.font);
      if (line.length && used + spaceWidth + wordWidth > width) flush();
      if (pendingSpace) {
        append(pendingSpace);
        used += spaceWidth;
        pendingSpace = null;
      }
      while (wordWidth > width - used && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), pieceSize, run.font) > width - used) cut -= 1;
        if (cut <= 1 && line.length) {
          flush();
          continue;
        }
        append({ ...run, text: word.slice(0, cut) });
        flush();
        word = word.slice(cut);
        wordWidth = textWidth(word, pieceSize, run.font);
      }
      append({ ...run, text: word });
      used += wordWidth;
    }
  }
  if (line.length || lines.length === 0) lines.push(line);
  return lines;
}

/** Plain text (user messages, notices): preserved line breaks, no markdown. */
export function plainLines(text: string, width: number, ink: PdfInk = 'body'): PdfLine[] {
  return wrapRuns([{ text: pdfSafe(text), font: 'regular', ink }], width, BODY_SIZE)
    .map((runs) => ({ kind: 'text', runs, size: BODY_SIZE, indent: 0 }));
}

// ---------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------

interface InlineStyle {
  bold: boolean;
  italic: boolean;
  ink: PdfInk | null;
}

function styledRun(text: string, style: InlineStyle, fallback: PdfInk): PdfRun {
  return {
    text: pdfSafe(text),
    font: style.bold ? 'bold' : style.italic ? 'italic' : 'regular',
    ink: style.ink ?? (style.bold ? 'text' : fallback),
  };
}

function plainText(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if ('children' in node) return plainText(node.children as PhrasingContent[]);
    return '';
  }).join('');
}

function inlineRuns(nodes: PhrasingContent[], style: InlineStyle, fallback: PdfInk): PdfRun[] {
  const runs: PdfRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        // Soft line breaks inside a paragraph flow as spaces.
        runs.push(styledRun(node.value.replace(/\s*\n\s*/g, ' '), style, fallback));
        break;
      case 'strong':
        runs.push(...inlineRuns(node.children, { ...style, bold: true }, fallback));
        break;
      case 'emphasis':
        runs.push(...inlineRuns(node.children, { ...style, italic: true }, fallback));
        break;
      case 'delete':
        runs.push(...inlineRuns(node.children, style, fallback));
        break;
      case 'inlineCode':
        runs.push({ text: pdfSafe(node.value), font: 'mono', ink: 'sand' });
        break;
      case 'inlineMath':
        runs.push({ text: pdfSafe(node.value), font: 'mono', ink: style.ink ?? fallback });
        break;
      case 'break':
        runs.push({ text: '\n', font: 'regular', ink: fallback });
        break;
      case 'link': {
        runs.push(...inlineRuns(node.children, { ...style, ink: 'teal' }, fallback));
        // Print the target too: a shared PDF has no hover to reveal it.
        const label = plainText(node.children).trim();
        if (node.url && label !== node.url && !node.url.startsWith('#')) {
          runs.push({ text: pdfSafe(` (${node.url})`), font: 'regular', ink: 'muted' });
        }
        break;
      }
      case 'linkReference':
        runs.push(...inlineRuns(node.children, style, fallback));
        break;
      case 'image':
      case 'imageReference':
        runs.push({ text: pdfSafe(`[image${node.alt ? `: ${node.alt}` : ''}]`), font: 'italic', ink: 'muted' });
        break;
      case 'footnoteReference':
        runs.push({ text: pdfSafe(`[${node.label ?? node.identifier}]`), font: 'regular', ink: 'muted' });
        break;
      case 'html':
        runs.push(styledRun(node.value, style, fallback));
        break;
      default:
        break;
    }
  }
  return runs;
}

interface BlockContext {
  width: number;
  indent: number;
  quoteBars: number[];
  ink: PdfInk;
  /** A tight list item: its blocks stack without spacing. */
  tight?: boolean;
  /** Unique keys for code boxes. */
  counter: { value: number };
}

const HEADING_SIZES = [12.5, 11, 10, 9, 9, 9];
const BLOCK_GAP: PdfLine = { kind: 'gap', height: 6 };

function textBlock(runs: PdfRun[], size: number, context: BlockContext): PdfLine[] {
  return wrapRuns(runs, context.width - context.indent, size).map((line) => ({
    kind: 'text',
    runs: line,
    size,
    indent: context.indent,
    ...(context.quoteBars.length ? { quoteBars: context.quoteBars } : {}),
  }));
}

function codeBlock(value: string, context: BlockContext): PdfLine[] {
  const box = `code-${context.counter.value++}`;
  const columns = Math.max(10, Math.floor((context.width - context.indent - 16) / (0.6 * CODE_SIZE)));
  const lines: PdfLine[] = [];
  for (const source of pdfSafe(value.replace(/\t/g, '    ')).split(/\r?\n/)) {
    if (!source) {
      lines.push({ kind: 'code', text: '', indent: context.indent, box });
      continue;
    }
    for (let start = 0; start < source.length; start += columns) {
      lines.push({ kind: 'code', text: source.slice(start, start + columns), indent: context.indent, box });
    }
  }
  return lines;
}

function listBlock(list: List, context: BlockContext): PdfLine[] {
  const lines: PdfLine[] = [];
  const start = list.start ?? 1;
  const markerWidth = list.ordered ? textWidth(`${start + list.children.length - 1}.`, BODY_SIZE, 'regular') + 6 : 12;
  list.children.forEach((item, index) => {
    if (index > 0 && list.spread) lines.push(BLOCK_GAP);
    const itemLines = blockLines(item.children, { ...context, indent: context.indent + markerWidth, tight: !list.spread });
    const first = itemLines.find((line) => line.kind === 'text');
    if (first?.kind === 'text') {
      first.marker = { text: list.ordered ? `${start + index}.` : null, indent: context.indent };
      if (typeof item.checked === 'boolean') {
        first.runs.unshift({ text: item.checked ? '[x] ' : '[ ] ', font: 'mono', ink: 'muted' });
      }
    }
    lines.push(...(itemLines.length ? itemLines : textBlock([{ text: '', font: 'regular', ink: context.ink }], BODY_SIZE, context)));
  });
  return lines;
}

function tableBlock(table: Table, context: BlockContext): PdfLine[] {
  const rows = table.children.map((row, rowIndex) => row.children.map((cell) => (
    inlineRuns(cell.children, { bold: rowIndex === 0, italic: false, ink: null }, context.ink)
  )));
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const available = context.width - context.indent;
  const padding = 10;
  const natural = Array.from({ length: columns }, (_, column) => (
    Math.max(24, ...rows.map((row) => Math.ceil(runsWidth(row[column] ?? [], BODY_SIZE)) + 1 + padding))
  ));
  let widths = natural;
  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total > available) {
    // Columns narrower than an equal share keep their width; the rest split what is left.
    const share = available / columns;
    const fixed = natural.filter((width) => width <= share);
    const flexible = natural.filter((width) => width > share);
    const remaining = available - fixed.reduce((sum, width) => sum + width, 0);
    const flexibleTotal = flexible.reduce((sum, width) => sum + width, 0);
    widths = natural.map((width) => (width <= share ? width : (width / flexibleTotal) * remaining));
  }
  const offsets = widths.map((_, column) => widths.slice(0, column).reduce((sum, width) => sum + width, 0));
  const lines: PdfLine[] = [];
  rows.forEach((row, rowIndex) => {
    const wrapped = widths.map((width, column) => wrapRuns(row[column] ?? [], width - padding, BODY_SIZE));
    const height = Math.max(...wrapped.map((cell) => cell.length));
    for (let index = 0; index < height; index += 1) {
      const last = index === height - 1;
      lines.push({
        kind: 'cells',
        indent: context.indent,
        cells: wrapped.map((cell, column) => ({ x: offsets[column]!, runs: cell[index] ?? [] })),
        rule: !last ? null : rowIndex === 0 ? 'header' : rowIndex < rows.length - 1 ? 'row' : null,
      });
    }
  });
  return lines;
}

function blockLines(nodes: RootContent[], context: BlockContext): PdfLine[] {
  const lines: PdfLine[] = [];
  for (const node of nodes) {
    const before = lines.length;
    switch (node.type) {
      case 'paragraph':
        lines.push(...textBlock(inlineRuns(node.children, { bold: false, italic: false, ink: null }, context.ink), BODY_SIZE, context));
        break;
      case 'heading':
        lines.push(...textBlock(
          inlineRuns(node.children, { bold: true, italic: false, ink: 'text' }, context.ink),
          HEADING_SIZES[node.depth - 1] ?? BODY_SIZE,
          context,
        ));
        break;
      case 'list':
        lines.push(...listBlock(node, context));
        break;
      case 'blockquote':
        lines.push(...blockLines(node.children, {
          ...context,
          indent: context.indent + 10,
          quoteBars: [...context.quoteBars, context.indent + 1],
          ink: 'muted',
          tight: false,
        }));
        break;
      case 'code':
      case 'math':
        lines.push(...codeBlock(node.value, context));
        break;
      case 'table':
        lines.push(...tableBlock(node, context));
        break;
      case 'thematicBreak':
        lines.push({ kind: 'rule', indent: context.indent });
        break;
      case 'html':
        lines.push(...textBlock([{ text: pdfSafe(node.value), font: 'regular', ink: 'muted' }], BODY_SIZE, context));
        break;
      case 'footnoteDefinition': {
        const inner = blockLines(node.children, { ...context, ink: 'muted' });
        const first = inner.find((line) => line.kind === 'text');
        if (first?.kind === 'text') first.runs.unshift({ text: pdfSafe(`[${node.label ?? node.identifier}] `), font: 'regular', ink: 'muted' });
        lines.push(...inner);
        break;
      }
      default:
        break;
    }
    if (lines.length > before && before > 0 && !context.tight) {
      lines.splice(before, 0, node.type === 'heading' ? { kind: 'gap', height: 9 } : BLOCK_GAP);
    }
  }
  return lines;
}

/** Assistant prose: rendered markdown (GFM), wrapped to `width` points. */
export function markdownLines(markdown: string, width: number, boxPrefix = 'md'): PdfLine[] {
  let tree: Root;
  try {
    tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  } catch {
    return plainLines(markdown, width);
  }
  const counter = { value: 0 };
  const lines = blockLines(tree.children, { width, indent: 0, quoteBars: [], ink: 'body', counter });
  for (const line of lines) if (line.kind === 'code') line.box = `${boxPrefix}-${line.box}`;
  return lines;
}

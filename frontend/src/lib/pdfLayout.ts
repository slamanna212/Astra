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

// Japanese (kana, kanji, CJK punctuation) and Korean (Hangul) are drawn with predefined Adobe CID
// fonts that PDF viewers supply themselves; every glyph in these ranges is one em wide.
const JAPANESE_RANGES = '\u3001-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff';
const KOREAN_RANGES = '\u1100-\u11ff\u3131-\u318e\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff';
// Emoji become private-use placeholders (one per grapheme) that the PDF writer draws as images.
const EMOJI_FIRST = 0xe000;
const EMOJI_LAST = 0xf8ff;
const EMOJI_RANGE = '\ue000-\uf8ff';
const KOREAN_CHARACTER = new RegExp(`[${KOREAN_RANGES}]`);
const TEXT_SCRIPT = new RegExp(`[${JAPANESE_RANGES}${KOREAN_RANGES}]`);
const SCRIPT_SEGMENTS = new RegExp(`([${JAPANESE_RANGES}]+|[${KOREAN_RANGES}]+|[${EMOJI_RANGE}]+)`);
// Japanese has no spaces, so each Japanese character or emoji is its own breakable piece.
const BREAK_PIECES = new RegExp(`(\\n|[ \\t]+|[${JAPANESE_RANGES}${EMOJI_RANGE}])`);
// Closing punctuation and small kana may hang past the margin rather than start a line.
const NO_LINE_START = /^[、。，．・ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ」』）〕】〉》〙〗！？：；]$/;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export type PdfScript = 'latin' | 'japanese' | 'korean' | 'emoji';

function isWideCode(code: number): boolean {
  return (code >= 0x3001 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3131 && code <= 0x318e)
    || (code >= 0xa960 && code <= 0xa97f) || (code >= 0xac00 && code <= 0xd7ff)
    || (code >= EMOJI_FIRST && code <= EMOJI_LAST);
}

function scriptOf(character: string): PdfScript {
  const code = character.charCodeAt(0);
  if (code >= EMOJI_FIRST && code <= EMOJI_LAST) return 'emoji';
  if (KOREAN_CHARACTER.test(character)) return 'korean';
  return 'japanese';
}

/** Split already pdfSafe text into runs per script, for font switching and emoji images. */
export function scriptSegments(text: string): { text: string; script: PdfScript }[] {
  return text.split(SCRIPT_SEGMENTS).flatMap((part, index) => {
    if (!part) return [];
    return [{ text: part, script: index % 2 === 1 ? scriptOf(part) : 'latin' }];
  });
}

// Placeholders are stable for the page's lifetime, so the writer can cache one image per emoji.
const emojiByPlaceholder = new Map<string, string>();
const placeholderByEmoji = new Map<string, string>();

function emojiPlaceholder(emoji: string): string {
  const existing = placeholderByEmoji.get(emoji);
  if (existing) return existing;
  const code = EMOJI_FIRST + placeholderByEmoji.size;
  if (code > EMOJI_LAST) return '?';
  const placeholder = String.fromCharCode(code);
  placeholderByEmoji.set(emoji, placeholder);
  emojiByPlaceholder.set(placeholder, emoji);
  return placeholder;
}

/** The emoji grapheme a placeholder stands for. */
export function emojiFor(placeholder: string): string | undefined {
  return emojiByPlaceholder.get(placeholder);
}

// PDF's built-in fonts use Windows-1252; keep to printable ASCII plus Japanese, Korean and emoji,
// mapping common punctuation and replacing anything else rather than emitting a corrupt document.
export function pdfSafe(text: string): string {
  // NFKC first: it keeps kana and Hangul composed (NFKD would decompose them) and folds full-width ASCII.
  const normalized = text
    .normalize('NFKC')
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
    .replace(/\u2713/g, '[x]')
    .replace(/\u00a9(?!\ufe0f)/g, '(c)')
    .replace(/\u00ae(?!\ufe0f)/g, '(R)')
    .replace(/[\u00a0\u2009\u202f]/g, ' ');
  let out = '';
  for (const { segment } of graphemes.segment(normalized)) {
    if (EMOJI.test(segment)) {
      out += emojiPlaceholder(segment);
      continue;
    }
    for (const character of segment) {
      if (TEXT_SCRIPT.test(character)) {
        out += character;
        continue;
      }
      // Strip accents from Latin letters; anything else unprintable becomes "?".
      for (const part of character.normalize('NFKD')) {
        const code = part.codePointAt(0) ?? 0;
        if (code >= 0x300 && code <= 0x36f) continue;
        out += code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) ? part : '?';
      }
    }
  }
  return out;
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

/** Advance width of already pdfSafe text. Oblique shares Helvetica's metrics; Courier is 0.6em; CJK and emoji are 1em. */
export function textWidth(text: string, size: number, font: PdfFont): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isWideCode(code)) units += 1000;
    else if (font === 'mono') units += 600;
    else units += table[code - 32] ?? 556;
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
    const pieces = run.text.split(BREAK_PIECES);
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
      if (line.length && used + spaceWidth + wordWidth > width && !NO_LINE_START.test(word)) flush();
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
  const available = Math.max(6 * CODE_SIZE, context.width - context.indent - 16);
  const lines: PdfLine[] = [];
  for (const source of pdfSafe(value.replace(/\t/g, '    ')).split(/\r?\n/)) {
    if (!source) {
      lines.push({ kind: 'code', text: '', indent: context.indent, box });
      continue;
    }
    // Hard-wrap by width: CJK characters and emoji are wider than Courier's 0.6em.
    let start = 0;
    while (start < source.length) {
      let end = start;
      let used = 0;
      while (end < source.length) {
        const advance = textWidth(source[end]!, CODE_SIZE, 'mono');
        if (end > start && used + advance > available) break;
        used += advance;
        end += 1;
      }
      lines.push({ kind: 'code', text: source.slice(start, end), indent: context.indent, box });
      start = end;
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

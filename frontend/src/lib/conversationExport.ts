import type { Message, MessageContent, MessageContentPart, SessionDetail } from '../api/types';
import { sessionTitle } from './format';
import { firstLine, formatToolDuration, shortTarget, summarizeToolNames, toolTitle } from './toolDisplay';
import { buildToolResultIndex } from './transcript';
import {
  CODE_SIZE,
  BODY_SIZE,
  emojiFor,
  fitText,
  lineHeight,
  markdownLines,
  pdfSafe,
  plainLines,
  runSize,
  scriptSegments,
  textWidth,
  type PdfLine,
  type PdfRun,
} from './pdfLayout';
import { buildTranscriptEntries, type ActivityBlock, type ToolItem } from './turnBlocks';

export type ConversationExportFormat = 'json' | 'markdown' | 'pdf';

export interface ConversationExport {
  version: 1;
  exported_at: string;
  session: SessionDetail;
  messages: Message[];
}

export function createConversationExport(session: SessionDetail, messages: Message[]): ConversationExport {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    session,
    messages,
  };
}

/** Commentary (Codex mid-turn narration) precedes the message body, as in the transcript. */
function visibleText(message: Message): string {
  return [message.commentary ?? '', contentText(message.content)].filter(Boolean).join('\n\n');
}

function contentText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (content === null) return '';
  return content.map((part) => {
    const text = part.text;
    if (typeof text === 'string') return text;
    return JSON.stringify(part, null, 2);
  }).join('\n');
}

function formatTimestamp(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds)) return '';
  return new Date(epochSeconds * 1000).toISOString();
}

function headingRole(role: string): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Message';
}

export function conversationToMarkdown(data: ConversationExport): string {
  const title = sessionTitle(data.session);
  const lines = [
    `# ${title}`,
    '',
    `- Session ID: \`${data.session.id}\``,
    `- Source: ${data.session.source}`,
    `- Model: ${data.session.model ?? 'Unknown'}`,
    `- Started: ${formatTimestamp(data.session.started_at)}`,
    `- Exported: ${data.exported_at}`,
    '',
  ];

  for (const message of data.messages) {
    const timestamp = formatTimestamp(message.timestamp);
    lines.push(`## ${headingRole(message.role)}${timestamp ? ` — ${timestamp}` : ''}`, '');
    const text = visibleText(message);
    if (text) lines.push(text, '');
    if (message.reasoning) {
      lines.push('<details>', '<summary>Reasoning</summary>', '', message.reasoning, '', '</details>', '');
    }
    if (message.tool_calls?.length) {
      lines.push('### Tool calls', '');
      for (const call of message.tool_calls) {
        lines.push(`#### ${call.name ?? 'Tool'}`, '', '```json', JSON.stringify(call.arguments, null, 2), '```', '');
      }
    }
    if (!text && !message.reasoning && !message.tool_calls?.length) lines.push('_(No content)_', '');
    if (message.truncated) lines.push('> This message was truncated by the server.', '');
    if (message.compacted) lines.push('> Compacted message.', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// A small dependency-free PDF writer using the built-in Type 1 fonts; layout is in ./pdfLayout.
function pdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface PdfBubble {
  role: string;
  timestamp: number;
  isUser: boolean;
  lines: PdfLine[];
}

const PDF_COLORS = {
  bg: '0.055 0.063 0.075',
  chrome: '0.075 0.086 0.102',
  surface: '0.090 0.106 0.125',
  sunk: '0.082 0.098 0.118',
  border: '0.153 0.173 0.204',
  text: '0.906 0.918 0.933',
  body: '0.776 0.800 0.831',
  muted: '0.596 0.631 0.671',
  teal: '0.169 0.714 0.769',
  tealInk: '0.016 0.129 0.165',
  sand: '0.949 0.784 0.475',
  red: '0.898 0.392 0.392',
} as const;

const FONT_RESOURCES = { regular: 'F1', bold: 'F2', mono: 'F3', symbol: 'F4', italic: 'F5' } as const;

// Non-embedded Adobe CID gothics for Japanese and Korean: viewers substitute an installed font.
const CID_FONTS = {
  japanese: {
    resource: 'F6', name: 'HeiseiKakuGo-W5', encoding: 'UniJIS-UCS2-H', ordering: 'Japan1', supplement: 2,
    metrics: '/Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -221 /CapHeight 737 /StemV 114',
  },
  korean: {
    resource: 'F7', name: 'HYGoThic-Medium', encoding: 'UniKS-UCS2-H', ordering: 'Korea1', supplement: 1,
    metrics: '/Flags 4 /FontBBox [-6 -145 1003 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 59',
  },
} as const;

// No PDF font has emoji, so each one is drawn with the browser's emoji font into a small RGBA image.
const EMOJI_PIXELS = 48;
const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

interface EmojiImage {
  name: string;
  rgb: string;
  alpha: string;
}

const emojiImages = new Map<string, EmojiImage | null>();

function rasterizeEmoji(placeholder: string): EmojiImage | null {
  const emoji = emojiFor(placeholder);
  if (!emoji || typeof OffscreenCanvas === 'undefined') return null;
  const context = new OffscreenCanvas(EMOJI_PIXELS, EMOJI_PIXELS).getContext('2d');
  if (!context) return null;
  context.font = `${EMOJI_PIXELS * 0.82}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(emoji, EMOJI_PIXELS / 2, EMOJI_PIXELS * 0.54);
  const { data } = context.getImageData(0, 0, EMOJI_PIXELS, EMOJI_PIXELS);
  let rgb = '';
  let alpha = '';
  let visible = false;
  for (let index = 0; index < data.length; index += 4) {
    rgb += HEX_BYTES[data[index]!]! + HEX_BYTES[data[index + 1]!]! + HEX_BYTES[data[index + 2]!]!;
    alpha += HEX_BYTES[data[index + 3]!]!;
    if (data[index + 3]) visible = true;
  }
  return visible ? { name: `E${placeholder.charCodeAt(0).toString(16)}`, rgb, alpha } : null;
}

function emojiImage(placeholder: string): EmojiImage | null {
  if (!emojiImages.has(placeholder)) emojiImages.set(placeholder, rasterizeEmoji(placeholder));
  return emojiImages.get(placeholder) ?? null;
}

function utf16Hex(text: string): string {
  return Array.from(text, (character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
}

function roundedRect(x: number, y: number, width: number, height: number, radius = 7): string {
  const k = radius * 0.55228475;
  const right = x + width;
  const top = y + height;
  return [
    `${x + radius} ${y} m`, `${right - radius} ${y} l`,
    `${right - radius + k} ${y} ${right} ${y + radius - k} ${right} ${y + radius} c`,
    `${right} ${top - radius} l`, `${right} ${top - radius + k} ${right - radius + k} ${top} ${right - radius} ${top} c`,
    `${x + radius} ${top} l`, `${x + radius - k} ${top} ${x} ${top - radius + k} ${x} ${top - radius} c`,
    `${x} ${y + radius} l`, `${x} ${y + radius - k} ${x + radius - k} ${y} ${x + radius} ${y} c h`,
  ].join('\n');
}

function circle(cx: number, cy: number, r: number): string {
  const k = r * 0.55228475;
  return [
    `${cx + r} ${cy} m`,
    `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c`,
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`,
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c`,
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c h`,
  ].join('\n');
}

function pdfText(text: string, x: number, y: number, options: {
  color?: string;
  font?: keyof typeof FONT_RESOURCES;
  size?: number;
} = {}): string {
  const font = options.font ?? 'regular';
  const size = options.size ?? 9;
  const color = options.color ?? PDF_COLORS.body;
  // Each script segment is placed at its own measured x, switching to the CID fonts or emoji images.
  const out: string[] = [];
  let cursor = x;
  for (const segment of scriptSegments(text)) {
    if (segment.script === 'emoji') {
      for (const placeholder of segment.text) {
        const image = emojiImage(placeholder);
        out.push(image
          ? `q ${size} 0 0 ${size} ${cursor} ${+(y - size * 0.18).toFixed(2)} cm /${image.name} Do Q`
          : `BT /${FONT_RESOURCES[font]} ${size} Tf ${color} rg ${cursor} ${y} Td (?) Tj ET`);
        cursor = +(cursor + size).toFixed(2);
      }
      continue;
    }
    const latin = segment.script === 'latin';
    const resource = segment.script === 'latin' ? FONT_RESOURCES[font] : CID_FONTS[segment.script].resource;
    const operand = latin ? `(${pdfString(segment.text)})` : `<${utf16Hex(segment.text)}>`;
    out.push(`BT /${resource} ${size} Tf ${color} rg ${cursor} ${y} Td ${operand} Tj ET`);
    cursor = +(cursor + textWidth(segment.text, size, font === 'symbol' ? 'regular' : font)).toFixed(2);
  }
  return out.join('\n');
}

function activityLines(block: ActivityBlock): PdfLine[] {
  const box = block.key;
  const steps: PdfLine[] = block.items.map((item) => {
    if (item.kind === 'thought') {
      const preview = firstLine(item.text).replace(/\*\*|__|`/g, '');
      return { kind: 'step', box, title: 'Thought', detail: pdfSafe(preview), mono: false, status: null };
    }
    if (item.kind === 'notice') {
      return { kind: 'step', box, title: pdfSafe(item.label), detail: '', mono: false, status: null };
    }
    const status = item.status === 'pending' ? null : item.status;
    return { kind: 'step', box, title: toolTitle(item.name), detail: pdfSafe(shortTarget(item)), mono: true, status };
  });
  if (block.items.length === 1) return steps;
  const tools = block.items.filter((item): item is ToolItem => item.kind === 'tool');
  const total = tools.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const duration = total > 0 ? formatToolDuration(total) : null;
  return [
    {
      kind: 'header',
      box,
      summary: tools.length > 0 ? summarizeToolNames(tools.map((item) => item.name)) : 'Thought',
      meta: `${block.items.length} steps${duration ? ` / ${duration}` : ''}`,
      failed: tools.filter((item) => item.status === 'error').length,
    },
    ...steps,
  ];
}

function partsMarkdown(parts: MessageContentPart[]): string {
  return parts.map((part) => (typeof part.text === 'string' ? part.text : `*[${part.type || 'attachment'}]*`)).join('\n\n');
}

/** Usable text width inside a bubble. */
const ASSISTANT_TEXT_WIDTH = 487 - 32;
const USER_TEXT_WIDTH = 399 - 32;

/**
 * The bubbles a reader sees in the transcript: one per user/notice message, and one per assistant
 * turn holding its rendered prose and compact activity steps. Raw tool arguments, tool output and
 * full reasoning are left to the JSON export.
 */
function pdfBubbles(messages: Message[]): PdfBubble[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const bubbles: PdfBubble[] = [];
  let turn: PdfBubble | null = null;
  for (const entry of buildTranscriptEntries(messages, buildToolResultIndex(messages))) {
    if (entry.kind === 'message') {
      turn = null;
      const isUser = entry.message.role === 'user';
      const text = visibleText(entry.message);
      bubbles.push({
        role: headingRole(entry.message.role),
        timestamp: entry.message.timestamp,
        isUser,
        lines: text ? plainLines(text, isUser ? USER_TEXT_WIDTH : ASSISTANT_TEXT_WIDTH) : [],
      });
      continue;
    }
    if (entry.first || !turn) {
      turn = { role: 'Assistant', timestamp: byId.get(entry.messageIds[0] ?? -1)?.timestamp ?? Number.NaN, isUser: false, lines: [] };
      bubbles.push(turn);
    }
    const { block } = entry;
    const lines = block.kind === 'activity' ? activityLines(block)
      : block.kind === 'text' ? markdownLines(block.text, ASSISTANT_TEXT_WIDTH, block.key)
        : block.kind === 'parts' ? markdownLines(partsMarkdown(block.parts), ASSISTANT_TEXT_WIDTH, block.key)
          : [];
    if (lines.length && turn.lines.length) turn.lines.push({ kind: 'gap', height: 8 });
    turn.lines.push(...lines);
    if (entry.last) turn = null;
  }
  for (const bubble of bubbles) {
    if (!bubble.lines.length) bubble.lines.push(...plainLines('(No content)', ASSISTANT_TEXT_WIDTH, 'muted'));
  }
  return bubbles;
}

/** Draw a row of styled runs starting at `x`. */
function drawRuns(runs: PdfRun[], x: number, y: number, size: number, isUser: boolean): string[] {
  const out: string[] = [];
  let cursor = x;
  for (const run of runs) {
    if (!run.text) continue;
    const runFontSize = runSize(run, size);
    out.push(pdfText(run.text, cursor, y, {
      color: isUser ? PDF_COLORS.tealInk : PDF_COLORS[run.ink],
      font: run.font,
      size: runFontSize,
    }));
    cursor += textWidth(run.text, runFontSize, run.font);
  }
  return out;
}

/** Draw one bubble row whose baseline is `y`; text starts at `left + 16`. */
function drawLine(line: PdfLine, left: number, right: number, y: number, isUser: boolean): string[] {
  const content = left + 16;
  const out: string[] = [];
  switch (line.kind) {
    case 'gap':
      return out;
    case 'text': {
      for (const bar of line.quoteBars ?? []) {
        out.push(`q ${PDF_COLORS.border} RG 1.6 w ${content + bar} ${y - 3} m ${content + bar} ${y + lineHeight(line) - 3} l S Q`);
      }
      if (line.marker) {
        const markerX = content + line.marker.indent;
        if (line.marker.text) out.push(pdfText(line.marker.text, markerX, y, { color: PDF_COLORS.muted, size: line.size }));
        else out.push(`q ${PDF_COLORS.muted} rg ${circle(markerX + 3, y + 2.8, 1.6)} f Q`);
      }
      out.push(...drawRuns(line.runs, content + line.indent, y, line.size, isUser));
      return out;
    }
    case 'code':
      if (line.text) out.push(pdfText(line.text, content + line.indent + 6, y, { color: PDF_COLORS.body, font: 'mono', size: CODE_SIZE }));
      return out;
    case 'cells':
      for (const cell of line.cells) out.push(...drawRuns(cell.runs, content + line.indent + cell.x, y, BODY_SIZE, isUser));
      if (line.rule) {
        const width = line.rule === 'header' ? 0.9 : 0.5;
        out.push(`q ${PDF_COLORS.border} RG ${width} w ${content + line.indent} ${y - 4} m ${right - 16} ${y - 4} l S Q`);
      }
      return out;
    case 'rule':
      out.push(`q ${PDF_COLORS.border} RG 0.8 w ${content + line.indent} ${y + 3} m ${right - 16} ${y + 3} l S Q`);
      return out;
    default:
      break;
  }
  const end = right - 18;
  if (line.kind === 'header') {
    // A "list" glyph: three short rules.
    for (const dy of [0, 2.6, 5.2]) out.push(`q ${PDF_COLORS.muted} RG 0.8 w ${left + 18} ${y + dy} m ${left + 25} ${y + dy} l S Q`);
    const metaWidth = textWidth(line.meta, 7, 'mono');
    out.push(pdfText(line.meta, end - metaWidth, y, { color: PDF_COLORS.muted, font: 'mono', size: 7 }));
    let summaryEnd = end - metaWidth - 10;
    if (line.failed > 0) {
      const failed = `${line.failed} failed`;
      const failedWidth = textWidth(failed, 7, 'bold');
      out.push(pdfText(failed, summaryEnd - failedWidth, y, { color: PDF_COLORS.red, font: 'bold', size: 7 }));
      summaryEnd -= failedWidth + 10;
    }
    out.push(pdfText(fitText(line.summary, summaryEnd - (left + 32), 8.5, 'bold'), left + 32, y, { color: PDF_COLORS.text, font: 'bold', size: 8.5 }));
    return out;
  }
  out.push(`q ${line.status === 'error' ? PDF_COLORS.red : PDF_COLORS.muted} rg ${circle(left + 21.5, y + 2.8, 2.2)} f Q`);
  const titleX = left + 32;
  const title = fitText(line.title, end - 14 - titleX, 8.5, 'bold');
  out.push(pdfText(title, titleX, y, { color: PDF_COLORS.text, font: 'bold', size: 8.5 }));
  const detailX = titleX + textWidth(title, 8.5, 'bold') + 7;
  const detailSize = line.mono ? 7.2 : 8;
  const detail = fitText(line.detail, end - 14 - detailX, detailSize, line.mono ? 'mono' : 'regular');
  if (detail) out.push(pdfText(detail, detailX, y, { color: PDF_COLORS.muted, font: line.mono ? 'mono' : 'regular', size: detailSize }));
  // ZapfDingbats: "4" is a check mark, "8" a cross.
  if (line.status === 'done') out.push(pdfText('4', end - 7, y, { color: PDF_COLORS.teal, font: 'symbol', size: 8 }));
  if (line.status === 'error') out.push(pdfText('8', end - 7, y, { color: PDF_COLORS.red, font: 'symbol', size: 8 }));
  return out;
}

function boxKey(line: PdfLine): string | null {
  return line.kind === 'header' || line.kind === 'step' || line.kind === 'code' ? line.box : null;
}

/** Inset cards behind each run of one box's rows (an activity group, a code block) on this page. */
function drawBoxes(chunk: PdfLine[], baselines: number[], left: number, right: number): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    const line = chunk[index]!;
    const key = boxKey(line);
    if (!key) {
      index += 1;
      continue;
    }
    let stop = index + 1;
    while (stop < chunk.length && boxKey(chunk[stop]!) === key) stop += 1;
    const inset = line.kind === 'code' ? 16 + line.indent : 10;
    const right_ = line.kind === 'code' ? right - 16 : right - 10;
    const top = baselines[index]! + 10;
    const bottom = baselines[stop - 1]! - 5;
    out.push(`q ${PDF_COLORS.sunk} rg ${PDF_COLORS.border} RG 0.6 w ${roundedRect(left + inset, bottom, right_ - left - inset, top - bottom, 5)} B Q`);
    index = stop;
  }
  return out;
}

export function conversationToPdf(data: ConversationExport): Blob {
  const pages: string[][] = [];
  let commands: string[] = [];
  let cursorY = 730;

  const startPage = () => {
    commands = [
      `q ${PDF_COLORS.bg} rg 0 0 595 842 re f Q`,
      `q ${PDF_COLORS.chrome} rg 0 766 595 76 re f Q`,
      `q ${PDF_COLORS.border} RG 0 766 m 595 766 l S Q`,
      `q ${PDF_COLORS.teal} rg 30 789 28 28 re f Q`,
      pdfText('A', 39, 797, { color: PDF_COLORS.tealInk, font: 'bold', size: 12 }),
      pdfText('ASTRA', 70, 809, { color: PDF_COLORS.text, font: 'bold', size: 12 }),
      pdfText('CONVERSATION EXPORT', 70, 792, { color: PDF_COLORS.muted, font: 'mono', size: 7 }),
      pdfText(pdfSafe(sessionTitle(data.session)).slice(0, 56), 30, 746, { color: PDF_COLORS.text, font: 'bold', size: 15 }),
      pdfText(`${data.session.source.toUpperCase()}  /  ${pdfSafe(data.session.model ?? 'UNKNOWN MODEL')}`.slice(0, 80), 30, 732, { color: PDF_COLORS.muted, font: 'mono', size: 7 }),
    ];
    cursorY = 710;
  };
  const finishPage = () => {
    const pageNumber = pages.length + 1;
    commands.push(
      `q ${PDF_COLORS.border} RG 30 28 m 565 28 l S Q`,
      pdfText(`SESSION ${pdfSafe(data.session.id).slice(0, 44)}`, 30, 14, { color: PDF_COLORS.muted, font: 'mono', size: 6.5 }),
      pdfText(`PAGE ${pageNumber}`, 515, 14, { color: PDF_COLORS.muted, font: 'mono', size: 6.5 }),
    );
    pages.push(commands);
  };

  startPage();
  for (const bubble of pdfBubbles(data.messages)) {
    const { isUser } = bubble;
    const x = isUser ? 166 : 54;
    const width = isUser ? 399 : 487;
    const allLines = bubble.lines;
    let offset = 0;
    let continuation = false;

    while (offset < allLines.length) {
      // A page never starts with spacing.
      while (continuation && allLines[offset]?.kind === 'gap') offset += 1;
      if (offset >= allLines.length) break;
      const available = cursorY - 97;
      if (available < 36) {
        finishPage();
        startPage();
        continue;
      }
      const chunk: PdfLine[] = [];
      let used = 0;
      while (offset + chunk.length < allLines.length) {
        const next = allLines[offset + chunk.length]!;
        if (chunk.length && used + lineHeight(next) > available) break;
        chunk.push(next);
        used += lineHeight(next);
      }
      const height = 38 + used;
      const bottom = cursorY - height;
      const fill = isUser ? PDF_COLORS.teal : PDF_COLORS.surface;
      const stroke = isUser ? PDF_COLORS.teal : PDF_COLORS.border;
      commands.push(`q ${fill} rg ${stroke} RG 0.8 w ${roundedRect(x, bottom, width, height)} B Q`);
      if (!isUser) {
        commands.push(`q ${PDF_COLORS.teal} rg 26 ${cursorY - 23} 18 18 re f Q`);
        commands.push(pdfText('A', 32, cursorY - 18, { color: PDF_COLORS.tealInk, font: 'bold', size: 8 }));
      }
      const role = `${bubble.role.toUpperCase()}${continuation ? '  /  CONTINUED' : ''}`;
      const labelColor = isUser ? PDF_COLORS.tealInk : PDF_COLORS.sand;
      commands.push(pdfText(role, x + 13, cursorY - 17, { color: labelColor, font: 'bold', size: 7.5 }));
      commands.push(pdfText(formatTimestamp(bubble.timestamp).replace('T', ' ').replace('.000Z', ' UTC'), x + width - 145, cursorY - 17, {
        color: isUser ? PDF_COLORS.tealInk : PDF_COLORS.muted,
        font: 'mono',
        size: 6.5,
      }));
      // Each row sits below the previous one; its baseline is 3pt above its bottom edge.
      const baselines: number[] = [];
      let top = cursorY - 25;
      for (const line of chunk) {
        top -= lineHeight(line);
        baselines.push(top + 3);
      }
      if (!isUser) commands.push(...drawBoxes(chunk, baselines, x, x + width));
      chunk.forEach((line, index) => {
        commands.push(...drawLine(line, x, x + width, baselines[index]!, isUser));
      });
      cursorY = bottom - 14;
      offset += chunk.length;
      continuation = true;
      if (offset < allLines.length) {
        finishPage();
        startPage();
      }
    }
  }
  if (data.messages.length === 0) {
    commands.push(pdfText('No messages in this conversation.', 54, 680, { color: PDF_COLORS.muted, size: 10 }));
  }
  finishPage();

  const pageObjectStart = 3;
  const regularFontObject = pageObjectStart + pages.length * 2;
  const boldFontObject = regularFontObject + 1;
  const monoFontObject = regularFontObject + 2;
  const symbolFontObject = regularFontObject + 3;
  const italicFontObject = regularFontObject + 4;
  const used = pages.flat().join('\n');
  // Optional objects follow the five base fonts: CID fonts (3 objects each), then emoji images (2 each).
  let nextObject = regularFontObject + 5;
  const extraObjects: string[] = [];
  const extraFonts: string[] = [];
  for (const font of Object.values(CID_FONTS)) {
    if (!used.includes(`/${font.resource} `)) continue;
    extraFonts.push(`/${font.resource} ${nextObject} 0 R`);
    extraObjects.push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /${font.encoding} /DescendantFonts [${nextObject + 1} 0 R] >>`,
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (${font.ordering}) /Supplement ${font.supplement} >> /FontDescriptor ${nextObject + 2} 0 R /DW 1000 >>`,
      `<< /Type /FontDescriptor /FontName /${font.name} ${font.metrics} >>`,
    );
    nextObject += 3;
  }
  const xObjects: string[] = [];
  const usedImages = new Set(Array.from(used.matchAll(/\/(E[0-9a-f]{4}) Do/g), (match) => match[1]));
  for (const image of emojiImages.values()) {
    if (!image || !usedImages.has(image.name)) continue;
    xObjects.push(`/${image.name} ${nextObject} 0 R`);
    const header = `/Type /XObject /Subtype /Image /Width ${EMOJI_PIXELS} /Height ${EMOJI_PIXELS} /BitsPerComponent 8 /Filter /ASCIIHexDecode`;
    extraObjects.push(
      `<< ${header} /ColorSpace /DeviceRGB /SMask ${nextObject + 1} 0 R /Length ${image.rgb.length + 1} >>\nstream\n${image.rgb}>\nendstream`,
      `<< ${header} /ColorSpace /DeviceGray /Length ${image.alpha.length + 1} >>\nstream\n${image.alpha}>\nendstream`,
    );
    nextObject += 2;
  }
  const fontResources = [
    `/F1 ${regularFontObject} 0 R /F2 ${boldFontObject} 0 R /F3 ${monoFontObject} 0 R /F4 ${symbolFontObject} 0 R /F5 ${italicFontObject} 0 R`,
    ...extraFonts,
  ].join(' ');
  const resources = `/Font << ${fontResources} >>${xObjects.length ? ` /XObject << ${xObjects.join(' ')} >>` : ''}`;
  const objects: string[] = [];
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageObject = pageObjectStart + index * 2;
    const contentObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${resources} >> /Contents ${contentObject} 0 R >>`);
    const stream = page.join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  objects.push(...extraObjects);

  let pdf = '%PDF-1.4\n%ASTRA\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}

export function exportFilename(session: SessionDetail, extension: string): string {
  const stem = sessionTitle(session)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'conversation';
  return `${stem}.${extension}`;
}

export function conversationExportBlob(data: ConversationExport, format: ConversationExportFormat): Blob {
  if (format === 'pdf') return conversationToPdf(data);
  if (format === 'markdown') return new Blob([conversationToMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
  return new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
}

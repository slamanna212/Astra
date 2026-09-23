import type { Message, MessageContent, SessionDetail } from '../api/types';
import { sessionTitle } from './format';

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

// A small dependency-free PDF writer. PDF's built-in Helvetica font uses Windows-1252, so map
// common punctuation and replace unsupported glyphs rather than emitting a corrupt document.
function pdfSafe(text: string): string {
  const normalized = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return Array.from(normalized, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) ? character : '?';
  }).join('');
}

function wrapLine(line: string, width = 94): string[] {
  if (!line) return [''];
  const output: string[] = [];
  let rest = line.replace(/\t/g, '    ');
  while (rest.length > width) {
    let split = rest.lastIndexOf(' ', width);
    if (split < Math.floor(width / 2)) split = width;
    output.push(rest.slice(0, split));
    rest = rest.slice(split).trimStart();
  }
  output.push(rest);
  return output;
}

function pdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

type PdfTone = 'body' | 'muted' | 'reasoning' | 'tool';
type PdfLine = { text: string; tone: PdfTone; mono?: boolean; label?: boolean };

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
} as const;

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

function pdfText(text: string, x: number, y: number, options: {
  color?: string;
  font?: 'regular' | 'bold' | 'mono';
  size?: number;
} = {}): string {
  const font = options.font === 'bold' ? 'F2' : options.font === 'mono' ? 'F3' : 'F1';
  return `BT /${font} ${options.size ?? 9} Tf ${options.color ?? PDF_COLORS.body} rg ${x} ${y} Td (${pdfString(text)}) Tj ET`;
}

function messagePdfLines(message: Message, width: number): PdfLine[] {
  const output: PdfLine[] = [];
  const add = (text: string, tone: PdfTone, mono = false, label = false) => {
    for (const sourceLine of pdfSafe(text).split(/\r?\n/)) {
      for (const line of wrapLine(sourceLine, width)) output.push({ text: line, tone, mono, label });
    }
  };
  const content = visibleText(message);
  if (content) add(content, 'body');
  if (message.reasoning) {
    if (output.length) output.push({ text: '', tone: 'muted' });
    add('REASONING', 'reasoning', true, true);
    add(message.reasoning, 'muted');
  }
  for (const call of message.tool_calls ?? []) {
    if (output.length) output.push({ text: '', tone: 'muted' });
    add(`TOOL  ${call.name ?? 'Tool'}`, 'tool', true, true);
    add(JSON.stringify(call.arguments, null, 2), 'muted', true);
  }
  if (!output.length) output.push({ text: '(No content)', tone: 'muted' });
  return output;
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
  for (const message of data.messages) {
    const isUser = message.role === 'user';
    const x = isUser ? 166 : 54;
    const width = isUser ? 399 : 487;
    const textWidth = isUser ? 67 : 82;
    const allLines = messagePdfLines(message, textWidth);
    let offset = 0;
    let continuation = false;

    while (offset < allLines.length) {
      const availableLines = Math.floor((cursorY - 55 - 42) / 12);
      if (availableLines < 3) {
        finishPage();
        startPage();
        continue;
      }
      const maxLines = availableLines;
      const chunk = allLines.slice(offset, offset + maxLines);
      const height = 38 + chunk.length * 12;
      const bottom = cursorY - height;
      const fill = isUser ? PDF_COLORS.teal : PDF_COLORS.surface;
      const stroke = isUser ? PDF_COLORS.teal : PDF_COLORS.border;
      commands.push(`q ${fill} rg ${stroke} RG 0.8 w ${roundedRect(x, bottom, width, height)} B Q`);
      if (!isUser) {
        commands.push(`q ${PDF_COLORS.teal} rg 26 ${cursorY - 23} 18 18 re f Q`);
        commands.push(pdfText('A', 32, cursorY - 18, { color: PDF_COLORS.tealInk, font: 'bold', size: 8 }));
      }
      const role = `${headingRole(message.role).toUpperCase()}${continuation ? '  /  CONTINUED' : ''}`;
      const labelColor = isUser ? PDF_COLORS.tealInk : PDF_COLORS.sand;
      commands.push(pdfText(role, x + 13, cursorY - 17, { color: labelColor, font: 'bold', size: 7.5 }));
      commands.push(pdfText(formatTimestamp(message.timestamp).replace('T', ' ').replace('.000Z', ' UTC'), x + width - 145, cursorY - 17, {
        color: isUser ? PDF_COLORS.tealInk : PDF_COLORS.muted,
        font: 'mono',
        size: 6.5,
      }));
      let lineY = cursorY - 34;
      for (const line of chunk) {
        const color = isUser ? PDF_COLORS.tealInk
          : line.tone === 'reasoning' ? PDF_COLORS.sand
            : line.tone === 'tool' ? PDF_COLORS.teal
              : line.tone === 'muted' ? PDF_COLORS.muted : PDF_COLORS.body;
        if (!isUser && line.label) {
          commands.push(`q ${line.tone === 'reasoning' ? PDF_COLORS.sand : PDF_COLORS.teal} rg ${x + 10} ${lineY - 2} 2 10 re f Q`);
        }
        commands.push(pdfText(line.text, x + 16, lineY, {
          color,
          font: line.label ? 'bold' : line.mono ? 'mono' : 'regular',
          size: line.mono ? 7.2 : 8.5,
        }));
        lineY -= 12;
      }
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
  const objects: string[] = [];
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageObject = pageObjectStart + index * 2;
    const contentObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontObject} 0 R /F2 ${boldFontObject} 0 R /F3 ${monoFontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const stream = page.join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

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

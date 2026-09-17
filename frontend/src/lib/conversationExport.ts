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
    const text = contentText(message.content);
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

function plainText(data: ConversationExport): string {
  const lines = [
    sessionTitle(data.session),
    `Session: ${data.session.id}`,
    `Source: ${data.session.source}`,
    `Model: ${data.session.model ?? 'Unknown'}`,
    `Exported: ${data.exported_at}`,
    '',
  ];
  for (const message of data.messages) {
    lines.push(`${headingRole(message.role)} - ${formatTimestamp(message.timestamp)}`);
    const text = contentText(message.content);
    if (text) lines.push(text);
    if (message.reasoning) lines.push(`Reasoning:\n${message.reasoning}`);
    if (message.tool_calls?.length) lines.push(`Tool calls:\n${JSON.stringify(message.tool_calls, null, 2)}`);
    lines.push('');
  }
  return lines.join('\n');
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

export function conversationToPdf(data: ConversationExport): Blob {
  const lines = pdfSafe(plainText(data)).split(/\r?\n/).flatMap((line) => wrapLine(line));
  const linesPerPage = 56;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) pages.push([]);

  const pageObjectStart = 3;
  const fontObject = pageObjectStart + pages.length * 2;
  const objects: string[] = [];
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageObject = pageObjectStart + index * 2;
    const contentObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const commands = ['BT', '/F1 9 Tf', '11 TL', '40 802 Td'];
    page.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push('T*');
      commands.push(`(${pdfString(line)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

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

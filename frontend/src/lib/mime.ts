/**
 * Client-side file-kind classification for the Files browser: which icon to show, and (for text
 * files) which highlight.js language to load. This is display-only — the backend independently
 * decides what is previewable/downloadable/inline (astra/files.py); nothing here is a security
 * boundary.
 */

import {
  IconCode,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconFolder,
  IconMarkdown,
  IconPhoto,
  type Icon,
} from '@tabler/icons-react';

export type FileKind = 'directory' | 'image' | 'markdown' | 'code' | 'text' | 'pdf' | 'archive' | 'other';

const CODE_EXTENSIONS: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  lua: 'lua',
  graphql: 'graphql',
  proto: 'protobuf',
};

const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function fileKind(name: string, mime: string | null | undefined, isDir: boolean): FileKind {
  if (isDir) return 'directory';
  const ext = extensionOf(name);
  if (mime?.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (ext in CODE_EXTENSIONS) return 'code';
  if (mime?.startsWith('text/')) return 'text';
  return 'other';
}

const ICONS: Record<FileKind, Icon> = {
  directory: IconFolder,
  image: IconPhoto,
  markdown: IconMarkdown,
  code: IconCode,
  text: IconFileText,
  pdf: IconFileTypePdf,
  archive: IconFileZip,
  other: IconFile,
};

export function iconForKind(kind: FileKind): Icon {
  return ICONS[kind];
}

/** highlight.js language name for a filename, or null when there is no useful mapping. */
export function highlightLanguage(name: string): string | null {
  return CODE_EXTENSIONS[extensionOf(name)] ?? null;
}

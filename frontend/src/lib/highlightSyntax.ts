/** Loaded only by the highlighting worker. Keep grammars off the browser's main thread. */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { sliceHighlightedHtml } from './highlightWindow';

// A superset of CODE_EXTENSIONS in lib/mime.ts: chat fences also name languages (diff, dockerfile,
// shell sessions…) that never appear as file extensions. Grammar aliases (ts, py, sh, yml, html…)
// resolve through hljs.getLanguage.
const LANGUAGES: Record<string, typeof javascript> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  perl,
  php,
  plaintext,
  powershell,
  protobuf,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
for (const [name, grammar] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, grammar);
}

// Retain just the last document so paging does not repeat highlighting, without an unbounded cache.
let cached: { code: string; language: string; html: string } | undefined;

export function highlightWindow(code: string, language: string, start: number, end: number): string | null {
  if (!hljs.getLanguage(language) || language === 'plaintext') return null;
  if (cached?.code !== code || cached.language !== language) {
    cached = { code, language, html: hljs.highlight(code, { language }).value };
  }
  const html = sliceHighlightedHtml(cached.html, start, end);
  // Some grammars can emit many tiny spans. Keep even their returned markup bounded.
  return html.length <= 256 * 1024 ? html : null;
}

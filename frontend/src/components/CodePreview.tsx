/**
 * Syntax-highlighted code preview. Lazy-loaded (see pages/files/FilePreview.tsx) so highlight.js
 * — a genuinely heavy dependency — never lands in the main bundle, only in a chunk fetched when a
 * source file is actually previewed. Uses the `core` build plus a curated set of per-language
 * grammars (matching lib/mime.ts's extension map) rather than the full ~190-language bundle,
 * which would otherwise nearly double this already-lazy chunk's size for no benefit.
 */
import { CodeHighlight, CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// Keep in sync with CODE_EXTENSIONS in lib/mime.ts.
const LANGUAGES: Record<string, typeof javascript> = {
  bash,
  c,
  cpp,
  css,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  perl,
  php,
  plaintext,
  protobuf,
  python,
  ruby,
  rust,
  scss,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, grammar] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, grammar);
}

const adapter = createHighlightJsAdapter(hljs);

export default function CodePreview({ code, language }: { code: string; language: string | null }) {
  return (
    <CodeHighlightAdapterProvider adapter={adapter}>
      <CodeHighlight code={code} language={language ?? 'plaintext'} withCopyButton copyLabel="Copy code" radius="sm" />
    </CodeHighlightAdapterProvider>
  );
}

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
import classes from './CodePreview.module.css';

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

const adapter = createHighlightJsAdapter(hljs);

export default function CodePreview({
  code,
  language,
  withLanguageLabel = false,
}: {
  code: string;
  language: string | null;
  /** Show a header strip naming the fence's language (chat/markdown blocks). */
  withLanguageLabel?: boolean;
}) {
  return (
    <div className={classes.frame} data-labelled={withLanguageLabel || undefined}>
      {withLanguageLabel && <div className={classes.header}>{language ?? 'text'}</div>}
      <CodeHighlightAdapterProvider adapter={adapter}>
        <CodeHighlight
          code={code}
          language={language?.toLowerCase() ?? 'plaintext'}
          withCopyButton
          copyLabel="Copy"
          copiedLabel="Copied"
          classNames={{ codeHighlight: classes.codeHighlight, controls: classes.controls, code: classes.code }}
        />
      </CodeHighlightAdapterProvider>
    </div>
  );
}

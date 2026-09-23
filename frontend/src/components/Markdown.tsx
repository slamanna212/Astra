import { Anchor, Code, Table, Text } from '@mantine/core';
import { isValidElement, lazy, memo, Suspense, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { CODE_PAGE_CHARS } from '../lib/highlightWindow';
import 'katex/dist/katex.min.css';
import classes from './Markdown.module.css';

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: MarkdownNode[];
};

const MEDIA_TOKEN_RE = /(?:^|(?<=\s))["']?MEDIA:\s*([^\s)\]>`"']+)["']?/g;

function mediaImageUrl(ref: string, sessionId?: string): string {
  if (/^https?:\/\//i.test(ref) || /^data:image\//i.test(ref)) return ref;
  const params = new URLSearchParams({ path: ref });
  if (sessionId) params.set('session_id', sessionId);
  return `/api/media?${params.toString()}`;
}

function mediaAlt(ref: string): string {
  const clean = ref.split(/[?#]/, 1)[0] ?? ref;
  return clean.split(/[\\/]/).at(-1) || 'Generated image';
}

/** Convert Hermes MEDIA tokens in ordinary prose into mdast image nodes. Code blocks are never
 * visited; an inline-code node is converted only when the whole node is one MEDIA token. */
function remarkHermesMedia(sessionId?: string) {
  return () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === 'code' || node.type === 'image') return;
      const next: MarkdownNode[] = [];
      const children = node.children;
      for (let index = 0; index < children.length; index++) {
        const child = children[index]!;
        // GFM autolink-literal parses `MEDIA:https://…` into text `…MEDIA:` + a link node, so
        // rejoin the bare URL with its prefix before scanning for tokens.
        const linked = children[index + 1];
        if (
          child.type === 'text' &&
          /(?:^|\s)MEDIA:\s*$/.test(child.value ?? '') &&
          linked?.type === 'link' &&
          linked.url &&
          linked.children?.length === 1 &&
          linked.children[0]?.type === 'text' &&
          linked.children[0].value === linked.url
        ) {
          const value = (child.value ?? '').replace(/MEDIA:\s*$/, '');
          if (value) next.push({ type: 'text', value });
          next.push({ type: 'image', url: mediaImageUrl(linked.url, sessionId), alt: mediaAlt(linked.url) });
          index++;
        } else if (child.type === 'text' && child.value?.includes('MEDIA:')) {
          const value = child.value;
          let cursor = 0;
          for (const match of value.matchAll(MEDIA_TOKEN_RE)) {
            const start = match.index ?? 0;
            if (start > cursor) next.push({ type: 'text', value: value.slice(cursor, start) });
            const ref = match[1];
            if (!ref) continue;
            next.push({ type: 'image', url: mediaImageUrl(ref, sessionId), alt: mediaAlt(ref) });
            cursor = start + match[0].length;
          }
          if (cursor < value.length) next.push({ type: 'text', value: value.slice(cursor) });
          if (cursor === 0) next.push(child);
        } else if (child.type === 'inlineCode' && /^MEDIA:\s*\S+$/.test(child.value ?? '')) {
          const ref = (child.value ?? '').replace(/^MEDIA:\s*/, '');
          next.push({ type: 'image', url: mediaImageUrl(ref, sessionId), alt: mediaAlt(ref) });
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

// highlight.js is a genuinely heavy dependency (see CodePreview.tsx) — only fetched once a fenced
// code block actually renders.
const CodePreview = lazy(() => import('./CodePreview'));
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

function extractCodeBlock(children: ReactNode): { code: string; language: string | null } {
  const child = Array.isArray(children) ? children[0] : children;
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const className = child.props.className ?? '';
    const language = /language-(\w+)/.exec(className)?.[1] ?? null;
    return { code: String(child.props.children ?? '').replace(/\n$/, ''), language };
  }
  return { code: String(children ?? '').replace(/\n$/, ''), language: null };
}

function MermaidBlock({ code }: { code: string }) {
  return (
    <Suspense fallback={<Code block>{code}</Code>}>
      <MermaidDiagram definition={code} />
    </Suspense>
  );
}

function RichPre({ children }: { children?: ReactNode }) {
  const { code, language } = extractCodeBlock(children);
  if (language?.toLowerCase() === 'mermaid') {
    return <MermaidBlock code={code} />;
  }
  return (
    <Suspense fallback={<Code block>{code.slice(0, CODE_PAGE_CHARS)}</Code>}>
      <CodePreview code={code} language={language} withLanguageLabel />
    </Suspense>
  );
}

// Theme Table styles are inline, so the chat-relative sizes have to come through `styles` too.
// Markdown headers are content ("Monthly cost (USD)"), not UI labels, so they drop the theme's
// mono-caps label treatment and read as normal sans text.
const tableStyles = {
  th: {
    fontFamily: 'var(--astra-font)',
    fontSize: 'calc(var(--astra-chat-font-size, 14px) * 0.9)',
    fontWeight: 600,
    letterSpacing: 'normal',
    textTransform: 'none' as const,
    color: 'var(--astra-text)',
  },
  td: { fontSize: 'calc(var(--astra-chat-font-size, 14px) * 0.93)' },
};

// Deliberately no rehype-raw: rendering raw HTML embedded in markdown from a file/tool source is
// an XSS vector we don't need to take on for a preview pane.
const baseComponents: Components = {
  a: ({ href, children, ...props }) => (
    <Anchor href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </Anchor>
  ),
  img: ({ alt, ...props }) => (
    <img {...props} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  ),
  table: ({ children, ...props }) => (
    <div className={classes.tableFrame}>
      <Table className={classes.table} withRowBorders={false} styles={tableStyles} {...props}>
        {children}
      </Table>
    </div>
  ),
  thead: Table.Thead,
  tbody: Table.Tbody,
  tr: Table.Tr,
  th: Table.Th,
  td: Table.Td,
  p: ({ children, ...props }) => (
    <Text component="p" style={{ fontSize: 'inherit' }} {...props}>
      {children}
    </Text>
  ),
};

const components: Components = { ...baseComponents, pre: RichPre };
const rehypePlugins = [rehypeKatex];

export const Markdown = memo(function Markdown({
  children,
  sessionId,
}: {
  children: string;
  /** Session used to authorize absolute local paths emitted in Hermes MEDIA tokens. */
  sessionId?: string;
}) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath, remarkHermesMedia(sessionId)], [sessionId]);
  return (
    <div className={classes.root}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

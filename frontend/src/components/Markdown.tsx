import { Anchor, Code, Table, Text } from '@mantine/core';
import { isValidElement, lazy, Suspense, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import classes from './Markdown.module.css';

// highlight.js is a genuinely heavy dependency (see CodePreview.tsx) — only fetched once a fenced
// code block actually renders, and only when a caller opts in via `codeHighlight`.
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
    <Suspense fallback={<Code block>{code}</Code>}>
      <CodePreview code={code} language={language} />
    </Suspense>
  );
}

function MermaidPre({ children }: { children?: ReactNode }) {
  const { code, language } = extractCodeBlock(children);
  return language?.toLowerCase() === 'mermaid' ? <MermaidBlock code={code} /> : <pre>{children}</pre>;
}

// Deliberately no rehype-raw: rendering raw HTML embedded in markdown from a file/tool source is
// an XSS vector we don't need to take on for a preview pane.
const baseComponents: Components = {
  a: ({ href, children, ...props }) => (
    <Anchor href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </Anchor>
  ),
  table: ({ children, ...props }) => (
    <Table.ScrollContainer minWidth={320}>
      <Table striped highlightOnHover withTableBorder {...props}>
        {children}
      </Table>
    </Table.ScrollContainer>
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

export function Markdown({
  children,
  codeHighlight = false,
}: {
  children: string;
  /** Render fenced code blocks with @mantine/code-highlight (lazy-loaded) instead of a plain
   * `<pre>`. Opt-in so most callers (file/memory previews) keep the lighter default. */
  codeHighlight?: boolean;
}) {
  const components = { ...baseComponents, pre: codeHighlight ? RichPre : MermaidPre };
  return (
    <div className={classes.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

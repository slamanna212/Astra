import { Anchor, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { ChildSession } from '../../../api/types';
import { highlightLanguage } from '../../../lib/mime';
import { formatToolArguments } from '../../../lib/toolDisplay';
import type { ToolItem } from '../../../lib/turnBlocks';
import { SubagentList } from './SubagentCard';
import classes from './Transcript.module.css';

// highlight.js is heavy; tool bodies only load it once a reader expands one.
const CodePreview = lazy(() => import('../../../components/CodePreview'));

type Json = Record<string, unknown>;

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function record(value: unknown): Json | null {
  const parsed = parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Json : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function CodeBlock({ code, language }: { code: string; language: string | null }) {
  return (
    <Suspense fallback={<pre className={classes.toolCode}>{code}</pre>}>
      <CodePreview code={code} language={language} />
    </Suspense>
  );
}

function Section({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Stack gap={2} className={classes.toolSection}>
      <Group gap={8} justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed" fw={600}>{label}</Text>
        {aside}
      </Group>
      {children}
    </Stack>
  );
}

function PlainOrJson({ value }: { value: string }) {
  const parsed = parse(value);
  if (parsed !== value) return <CodeBlock code={JSON.stringify(parsed, null, 2)} language="json" />;
  return <CodeBlock code={value} language={null} />;
}

function ErrorText({ children }: { children: ReactNode }) {
  return <Text size="xs" c="red" className={classes.toolError}>{children}</Text>;
}

function ExitBadge({ code }: { code: unknown }) {
  if (typeof code !== 'number') return null;
  return (
    <Badge size="xs" variant="light" color={code === 0 ? 'green' : 'red'} radius="sm">
      exit {code}
    </Badge>
  );
}

function ConsoleView({ command, language, result }: { command: string | null; language: string; result: string | null }) {
  const data = record(result);
  const output = data ? (text(data.output) ?? text(data.stdout) ?? '') : (result ?? '');
  const stderr = data ? text(data.stderr) : null;
  const error = data ? text(data.error) : null;
  const exitCode = data?.exit_code ?? data?.returncode;
  const script = language !== 'bash';
  return (
    <>
      {command && (script
        ? <Section label="Code"><CodeBlock code={command} language={language} /></Section>
        : <CodeBlock code={`$ ${command}`} language="bash" />)}
      {result !== null && (
        <Section label="Output" aside={<ExitBadge code={exitCode} />}>
          {output || stderr
            ? <CodeBlock code={[output, stderr].filter(Boolean).join('\n')} language={null} />
            : <Text size="xs" c="dimmed">(no output)</Text>}
        </Section>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </>
  );
}

/** read_file returns `N|line` rows; drop the gutter so the code highlights as code. */
function stripLineNumbers(content: string): string {
  const lines = content.split('\n');
  const numbered = /^\s*\d+\|/;
  const hits = lines.filter((line) => numbered.test(line)).length;
  if (hits < Math.max(1, lines.filter((line) => line.trim()).length * 0.8)) return content;
  return lines.map((line) => line.replace(numbered, '')).join('\n');
}

function ReadFileView({ path, result }: { path: string | null; result: string | null }) {
  if (result === null) return null;
  const data = record(result);
  const content = data ? (text(data.content) ?? text(data.text)) : result;
  const error = data ? text(data.error) : null;
  return (
    <>
      {content && <CodeBlock code={stripLineNumbers(content)} language={path ? highlightLanguage(path) : null} />}
      {error && <ErrorText>{error}</ErrorText>}
      {!content && !error && <PlainOrJson value={result} />}
    </>
  );
}

function StatusLine({ result }: { result: string | null }) {
  if (result === null) return null;
  const data = record(result);
  if (!data) return <Text size="xs" c="dimmed" className={classes.toolError}>{result}</Text>;
  const error = text(data.error);
  if (error) return <ErrorText>{error}</ErrorText>;
  const message = text(data.message) ?? text(data.status);
  return message ? <Text size="xs" c="dimmed">{message}</Text> : null;
}

function diffFromReplace(oldText: string, newText: string): string {
  const removed = oldText.split('\n').map((line) => `-${line}`);
  const added = newText.split('\n').map((line) => `+${line}`);
  return [...removed, ...added].join('\n');
}

function PatchView({ args, result }: { args: Json | null; result: string | null }) {
  const data = record(result);
  const diff = (data && text(data.diff))
    ?? text(args?.patch)
    ?? (typeof args?.old_string === 'string' && typeof args.new_string === 'string'
      ? diffFromReplace(args.old_string, args.new_string)
      : null);
  return (
    <>
      {diff && <CodeBlock code={diff} language="diff" />}
      {data ? (text(data.error) && <ErrorText>{text(data.error)}</ErrorText>) : result && <PlainOrJson value={result} />}
    </>
  );
}

function WriteFileView({ args, result }: { args: Json | null; result: string | null }) {
  const path = text(args?.path);
  const content = text(args?.content);
  return (
    <>
      {content && <CodeBlock code={content} language={path ? highlightLanguage(path) : null} />}
      <StatusLine result={result} />
    </>
  );
}

interface Link { url: string; title: string | null; description: string | null }

/** Web tools nest their hits differently across providers; collect anything shaped like a link. */
function findLinks(value: unknown, found: Link[] = [], depth = 0): Link[] {
  if (found.length >= 12 || depth > 5 || !value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const entry of value) findLinks(entry, found, depth + 1);
    return found;
  }
  const entry = value as Json;
  const url = text(entry.url) ?? text(entry.link) ?? text(entry.href);
  if (url && /^https?:\/\//i.test(url)) {
    found.push({
      url,
      title: text(entry.title) ?? text(entry.name),
      description: text(entry.description) ?? text(entry.snippet) ?? text(entry.summary),
    });
    return found;
  }
  for (const child of Object.values(entry)) findLinks(child, found, depth + 1);
  return found;
}

function WebView({ result }: { result: string | null }) {
  if (result === null) return null;
  const links = findLinks(parse(result));
  if (links.length === 0) return <PlainOrJson value={result} />;
  return (
    <Stack gap={8} className={classes.linkList}>
      {links.map((link, index) => (
        <div key={`${link.url}-${index}`}>
          <Anchor href={link.url} target="_blank" rel="noreferrer noopener" size="sm" fw={500} lineClamp={1}>
            {link.title || link.url}
          </Anchor>
          <Text size="xs" c="dimmed" lineClamp={1} ff="monospace">{link.url}</Text>
          {link.description && <Text size="xs" c="dimmed" lineClamp={2}>{link.description}</Text>}
        </div>
      ))}
    </Stack>
  );
}

function SearchView({ result }: { result: string | null }) {
  if (result === null) return null;
  const data = record(result);
  const matches = data && Array.isArray(data.matches) ? data.matches : null;
  if (matches && matches.every((match) => match && typeof match === 'object')) {
    const lines = (matches as Json[]).map((match) => {
      const file = text(match.path) ?? text(match.file) ?? '';
      const line = typeof match.line === 'number' ? `:${match.line}` : typeof match.line_number === 'number' ? `:${match.line_number}` : '';
      const content = text(match.content) ?? text(match.text) ?? '';
      return content ? `${file}${line}: ${content}` : `${file}${line}`;
    });
    return <CodeBlock code={lines.join('\n') || '(no matches)'} language={null} />;
  }
  const files = data && Array.isArray(data.files) ? data.files : null;
  if (files && files.every((file) => typeof file === 'string')) {
    return <CodeBlock code={(files as string[]).join('\n') || '(no files)'} language={null} />;
  }
  return <PlainOrJson value={result} />;
}

function Arguments({ item }: { item: ToolItem }) {
  const formatted = formatToolArguments(item.arguments);
  if (!formatted) return null;
  const parsed = parse(item.arguments);
  return (
    <Section label="Arguments">
      <CodeBlock code={formatted} language={parsed && typeof parsed === 'object' ? 'json' : null} />
    </Section>
  );
}

function GenericView({ item }: { item: ToolItem }) {
  return (
    <>
      <Arguments item={item} />
      {item.result !== null && <Section label="Result"><PlainOrJson value={item.result} /></Section>}
    </>
  );
}

function SpecificView({ item, childSessions }: { item: ToolItem; childSessions: ChildSession[] }) {
  const args = record(item.arguments);
  switch (item.name) {
    case 'terminal':
      return <ConsoleView command={text(args?.command) ?? text(args?.cmd)} language="bash" result={item.result} />;
    case 'execute_code':
      return (
        <ConsoleView
          command={text(args?.code)}
          language={(text(args?.language) ?? 'python').toLowerCase()}
          result={item.result}
        />
      );
    case 'read_file':
      return <ReadFileView path={text(args?.path)} result={item.result} />;
    case 'write_file':
      return <WriteFileView args={args} result={item.result} />;
    case 'patch':
      return <PatchView args={args} result={item.result} />;
    case 'search_files':
      return <SearchView result={item.result} />;
    case 'web_search':
    case 'web_extract':
      return <WebView result={item.result} />;
    case 'delegate_task':
      return (
        <>
          <SubagentList item={item} childSessions={childSessions} />
          {item.result !== null && <Section label="Result"><PlainOrJson value={item.result} /></Section>}
        </>
      );
    default:
      return <GenericView item={item} />;
  }
}

const SPECIALIZED = new Set(['terminal', 'execute_code', 'read_file', 'write_file', 'patch', 'search_files', 'web_search', 'web_extract', 'delegate_task']);

/** Expanded body of a tool row: a view shaped for the tool, with the raw call one click away. */
export function ToolResultView({ item, childSessions }: { item: ToolItem; childSessions: ChildSession[] }) {
  const [raw, setRaw] = useState(false);
  const specialized = SPECIALIZED.has(item.name ?? '');
  return (
    <Stack gap={6}>
      {raw || !specialized ? <GenericView item={item} /> : <SpecificView item={item} childSessions={childSessions} />}
      {item.result === null && item.status !== 'running' && item.name !== 'delegate_task' && (
        <Text size="xs" c="dimmed">No result was recorded.</Text>
      )}
      {item.argumentsTruncated && <Text size="xs" c="sand">Arguments were truncated by the server.</Text>}
      {item.resultTruncated && <Text size="xs" c="sand">Result truncated by the server; open the full message to see everything.</Text>}
      {specialized && (
        <Group justify="flex-end">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={(event) => { event.stopPropagation(); setRaw((value) => !value); }}
          >
            {raw ? 'Formatted view' : 'Raw call'}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

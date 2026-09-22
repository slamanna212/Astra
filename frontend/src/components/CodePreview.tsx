import { ActionIcon, Button, Group, Text, Tooltip } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { highlightClient } from '../lib/highlightClient';
import { codePages, type CodePage } from '../lib/highlightWindow';
import classes from './CodePreview.module.css';

function HighlightedPage({ code, language, page }: { code: string; language: string; page: CodePage }) {
  const [result, setResult] = useState<{ code: string; language: string; page: CodePage; html: string | null }>();
  useEffect(() => {
    if (language === 'plaintext' || code.length === 0) return;
    let disposed = false;
    const request = highlightClient.request({ code, language, ...page });
    void request.promise.then((html) => {
      if (!disposed) setResult({ code, language, page, html });
    });
    return () => {
      disposed = true;
      request.cancel();
    };
  }, [code, language, page]);
  const html = result?.code === code && result.language === language && result.page === page ? result.html : null;
  return (
    <pre className={classes.code} tabIndex={0} aria-label="Code preview">
      {html !== null && html !== undefined
        ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        : <code>{code.slice(page.start, page.end)}</code>}
    </pre>
  );
}

export default function CodePreview({ code, language, withLanguageLabel = false }: {
  code: string;
  language: string | null;
  withLanguageLabel?: boolean;
}) {
  const pages = useMemo(() => codePages(code), [code]);
  const [position, setPosition] = useState({ code, index: 0 });
  const index = position.code === code ? Math.min(position.index, pages.length - 1) : 0;
  const clipboard = useClipboard({ timeout: 1500 });
  return (
    <div className={classes.frame} data-labelled={withLanguageLabel || undefined}>
      {withLanguageLabel && <div className={classes.header}>{language ?? 'text'}</div>}
      <Tooltip label={clipboard.copied ? 'Copied' : 'Copy code'}>
        <ActionIcon className={classes.controls} size="xs" variant="subtle" color="gray"
          aria-label={clipboard.copied ? 'Copied' : 'Copy code'} onClick={() => clipboard.copy(code)}>
          {clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
      <HighlightedPage key={index} code={code} language={language?.toLowerCase() ?? 'plaintext'} page={pages[index]!} />
      {pages.length > 1 && (
        <Group className={classes.pagination} justify="space-between" gap="xs">
          <Button size="compact-xs" variant="subtle" disabled={index === 0}
            onClick={() => setPosition({ code, index: index - 1 })}>Previous</Button>
          <Text size="xs" c="dimmed" aria-live="polite">Page {index + 1} of {pages.length}</Text>
          <Button size="compact-xs" variant="subtle" disabled={index === pages.length - 1}
            onClick={() => setPosition({ code, index: index + 1 })}>Next</Button>
        </Group>
      )}
    </div>
  );
}

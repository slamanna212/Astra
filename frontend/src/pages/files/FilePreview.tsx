import { ActionIcon, Anchor, Badge, Button, Center, Group, Image, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconExternalLink, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { fileDownloadUrl, getFileContent } from '../../api/files';
import { queryKeys } from '../../api/queryKeys';
import type { FileContent } from '../../api/types';
import { formatBytes, formatDateTime } from '../../lib/format';
import { fileKind, highlightLanguage } from '../../lib/mime';
import classes from './FilePreview.module.css';

const Markdown = lazy(() => import('../../components/Markdown').then((m) => ({ default: m.Markdown })));
const CodePreview = lazy(() => import('../../components/CodePreview'));

function PreviewLoader() {
  return (
    <Center p="lg">
      <Loader size="sm" />
    </Center>
  );
}

function PreviewHeader({ path, onClose }: { path: string; onClose: () => void }) {
  const name = path.split('/').pop() || path;
  const url = fileDownloadUrl(path);
  return (
    <Group className={classes.header} wrap="nowrap">
      <ActionIcon
        className={classes.closeButton}
        variant="subtle"
        size="sm"
        aria-label="Close preview"
        onClick={onClose}
      >
        <IconX size={16} stroke={1.5} />
      </ActionIcon>
      <Text size="sm" fw={600} truncate="end" style={{ flex: 1, minWidth: 0 }} title={path}>
        {name}
      </Text>
      <Tooltip label="Open in new tab">
        <ActionIcon component="a" href={url} target="_blank" rel="noreferrer noopener" variant="subtle" size="sm" aria-label="Open in new tab">
          <IconExternalLink size={16} stroke={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Download">
        <ActionIcon component="a" href={url} variant="subtle" size="sm" aria-label="Download">
          <IconDownload size={16} stroke={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function FilePreviewContent({ path, onClose }: { path: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: queryKeys.files.content(path),
    queryFn: ({ signal }) => getFileContent(path, signal),
  });

  return (
    <div className={classes.root}>
      <PreviewHeader path={path} onClose={onClose} />
      <div className={classes.body}>
        {query.isPending ? (
          <PreviewLoader />
        ) : query.isError ? (
          <Stack align="center" gap="xs" p="lg">
            <Text size="sm" c="red">
              {query.error instanceof Error ? query.error.message : 'Failed to load this file.'}
            </Text>
            <Button size="xs" variant="light" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Stack>
        ) : (
          <FilePreviewBody path={path} data={query.data} />
        )}
      </div>
    </div>
  );
}

export function FilePreviewBody({
  path,
  data,
  fileUrl = fileDownloadUrl(path),
}: {
  path: string;
  data: FileContent;
  fileUrl?: string;
}) {
  const name = data.meta.name;
  const kind = fileKind(name, data.meta.mime, false);

  if (data.previewable && data.content !== null) {
    if (kind === 'markdown') {
      return (
        <Suspense fallback={<PreviewLoader />}>
          <Stack gap="xs">
            {data.truncated && (
              <Text size="xs" c="dimmed">
                Showing the first {formatBytes(data.content.length)} of this file.
              </Text>
            )}
            <Markdown codeHighlight>{data.content}</Markdown>
          </Stack>
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<PreviewLoader />}>
        <Stack gap="xs">
          {data.truncated && (
            <Text size="xs" c="dimmed">
              Showing the first {formatBytes(data.content.length)} of this file.
            </Text>
          )}
          <CodePreview code={data.content} language={highlightLanguage(name)} />
        </Stack>
      </Suspense>
    );
  }

  if (kind === 'image') {
    return (
      <Stack align="center" gap="xs">
        <Image maw="100%" src={fileUrl} alt={name} />
        <Text size="xs" c="dimmed">
          {formatBytes(data.meta.size)}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack align="center" gap="sm" p="lg">
      <Badge variant="light" color="gray">
        {data.meta.mime ?? 'unknown type'}
      </Badge>
      <Text size="sm" c="dimmed" ta="center">
        {data.reason ?? 'This file cannot be previewed.'}
      </Text>
      <Group gap={4}>
        <Text size="xs" c="dimmed">
          {formatBytes(data.meta.size)}
        </Text>
        <Text size="xs" c="dimmed">
          ·
        </Text>
        <Text size="xs" c="dimmed">
          {formatDateTime(data.meta.mtime)}
        </Text>
      </Group>
      <Anchor component="a" href={fileUrl} size="sm">
        Download
      </Anchor>
    </Stack>
  );
}

export function FilePreview({ path, onClose }: { path: string | null; onClose: () => void }) {
  if (!path) {
    return (
      <Center h="100%">
        <Text size="sm" c="dimmed">
          Select a file to preview.
        </Text>
      </Center>
    );
  }
  return <FilePreviewContent path={path} onClose={onClose} />;
}

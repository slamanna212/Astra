import { ActionIcon, Anchor, Breadcrumbs, Button, Center, Group, Loader, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconLink, IconRefresh, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { listFiles, uploadFile } from '../../api/files';
import { queryKeys } from '../../api/queryKeys';
import type { FileEntry } from '../../api/types';
import { formatBytes, formatDateTime, formatRelativeTime } from '../../lib/format';
import { fileKind, iconForKind } from '../../lib/mime';
import { breadcrumbs } from '../../lib/paths';
import { useNow } from '../../hooks/useNow';
import classes from './FileBrowser.module.css';

export const FILE_ROW_HEIGHT = 44;

interface FileRowProps {
  entry: FileEntry;
  active: boolean;
  now: number;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function FileRow({ entry, active, now, onOpenDirectory, onSelectFile }: FileRowProps) {
  const Icon = entry.is_symlink ? IconLink : iconForKind(fileKind(entry.name, entry.mime, entry.is_dir));
  const disabled = entry.is_symlink;
  const handleClick = () => {
    if (disabled) return;
    if (entry.is_dir) onOpenDirectory(entry.path);
    else onSelectFile(entry.path);
  };
  const row = (
    <UnstyledButton
      className={classes.row}
      style={{ height: FILE_ROW_HEIGHT }}
      onClick={handleClick}
      disabled={disabled}
      data-active={active || undefined}
      data-testid="file-row"
      aria-current={active ? 'page' : undefined}
    >
      {/* Icon is picked from a fixed lookup table (lib/mime.ts), never freshly constructed —
          the lint rule can't tell that statically, matching the existing `incompatible-library`
          disable convention used for TanStack Virtual elsewhere in this file. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon size={18} stroke={1.5} style={{ flexShrink: 0 }} aria-hidden />
      <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>
        {entry.name}
      </Text>
      {!entry.is_dir && (
        <Text component="span" className={classes.meta} style={{ flexShrink: 0, width: '4.5rem', textAlign: 'right' }}>
          {formatBytes(entry.size)}
        </Text>
      )}
      <Text component="span" className={classes.meta} style={{ flexShrink: 0, width: '4rem', textAlign: 'right' }} title={formatDateTime(entry.mtime)}>
        {formatRelativeTime(entry.mtime, now)}
      </Text>
    </UnstyledButton>
  );
  if (!disabled) return row;
  return (
    <Tooltip label="Symlinks are never followed and cannot be opened" position="top" withArrow>
      {row}
    </Tooltip>
  );
}

export function FileBrowser({
  dir,
  selected,
  onOpenDirectory,
  onSelectFile,
}: {
  dir: string;
  selected: string | null;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const now = useNow();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.files.listing(dir),
    queryFn: ({ signal }) => listFiles(dir, signal),
  });

  const entries = query.data?.entries ?? [];

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => entries[index]?.path ?? index,
  });

  const crumbs = breadcrumbs(dir);

  const refresh = () => void query.refetch();

  const handleDrop = async (files: File[]) => {
    setUploading(true);
    let succeeded = 0;
    for (const file of files) {
      try {
        // Sequential, not Promise.all: keeps upload progress/errors legible one file at a time
        // and avoids saturating the single-user backend with concurrent large writes.
        await uploadFile({ directory: dir, file });
        succeeded += 1;
      } catch (err) {
        notifications.show({
          color: 'red',
          title: `Failed to upload ${file.name}`,
          message: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }
    setUploading(false);
    if (succeeded > 0) {
      notifications.show({ color: 'green', message: `Uploaded ${succeeded} file${succeeded === 1 ? '' : 's'}` });
      void queryClient.invalidateQueries({ queryKey: queryKeys.files.listing(dir) });
    }
  };

  return (
    <>
      <Group gap={6} p="sm" wrap="nowrap" style={{ borderBottom: '1px solid var(--astra-border)' }}>
        <Breadcrumbs separator="/" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {crumbs.map((crumb, i) => (
            <Anchor
              key={crumb.path || '/'}
              component="button"
              type="button"
              size="sm"
              truncate="end"
              fw={i === crumbs.length - 1 ? 600 : 400}
              c={i === crumbs.length - 1 ? undefined : 'dimmed'}
              onClick={() => onOpenDirectory(crumb.path)}
            >
              {crumb.label}
            </Anchor>
          ))}
        </Breadcrumbs>
        <Tooltip label="Refresh">
          <ActionIcon variant="subtle" size="sm" aria-label="Refresh" onClick={refresh} loading={query.isFetching}>
            <IconRefresh size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {query.isPending ? (
        <Center p="xl">
          <Loader size="sm" aria-label="Loading files" />
        </Center>
      ) : query.isError ? (
        <Stack align="center" p="xl" gap="xs">
          <Text size="sm" c="red">
            {query.error instanceof Error ? query.error.message : 'Failed to load this directory.'}
          </Text>
          <Button size="xs" variant="light" onClick={refresh}>
            Retry
          </Button>
        </Stack>
      ) : entries.length === 0 ? (
        <Center p="xl">
          <Text size="sm" c="dimmed">
            This directory is empty.
          </Text>
        </Center>
      ) : (
        <div ref={scrollRef} className={classes.scroller} data-testid="file-list-scroller">
          <div role="list" aria-label="Files" style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = entries[item.index]!;
              return (
                <div
                  key={item.key}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <FileRow
                    entry={entry}
                    active={entry.path === selected}
                    now={now}
                    onOpenDirectory={onOpenDirectory}
                    onSelectFile={onSelectFile}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {query.data?.truncated && (
        <Text size="xs" c="dimmed" px="sm" py={4}>
          Showing the first {entries.length} entries — this directory has more.
        </Text>
      )}

      <Dropzone onDrop={handleDrop} loading={uploading} className={classes.dropzone} activateOnClick multiple>
        <Group gap="xs" justify="center" wrap="nowrap" py={4}>
          <IconUpload size={18} stroke={1.5} />
          <Text size="xs" c="dimmed">
            Drop files here to upload into this folder
          </Text>
        </Group>
      </Dropzone>
    </>
  );
}

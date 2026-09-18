import { ActionIcon, Alert, Box, Button, Center, Group, Loader, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconExternalLink, IconFile } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { queryKeys } from '../../api/queryKeys';
import { getSkillFileContent, skillFileOpenUrl } from '../../api/skills';
import { FilePreviewBody } from '../files/FilePreview';
import classes from './SkillDetail.module.css';

function groupFiles(files: string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const path of files) {
    const parts = path.split('/').filter(Boolean);
    const group = parts.length > 1 ? (parts[0] ?? 'Other') : 'Other';
    const items = groups.get(group) ?? [];
    items.push(path);
    groups.set(group, items);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => [group, items.sort((a, b) => a.localeCompare(b))]);
}

export function SkillFiles({
  category,
  name,
  files,
}: {
  category: string | null;
  name: string;
  files: string[];
}) {
  const skillKey = `${category ?? ''}/${name}`;
  const [selection, setSelection] = useState<{ skillKey: string; path: string } | null>(null);
  const selected = selection?.skillKey === skillKey && files.includes(selection.path)
    ? selection.path
    : files[0] ?? null;
  const groups = useMemo(() => groupFiles(files), [files]);
  const query = useQuery({
    queryKey: queryKeys.skills.file(category, name, selected ?? ''),
    queryFn: ({ signal }) => getSkillFileContent(category, name, selected ?? '', signal),
    enabled: selected !== null,
  });
  const fileUrl = selected ? skillFileOpenUrl(category, name, selected) : null;

  if (files.length === 0) {
    return (
      <Center py="xl">
        <Text size="sm" c="dimmed">This skill has no supporting files.</Text>
      </Center>
    );
  }

  return (
    <div className={classes.filesGrid}>
      <Paper withBorder className={classes.fileList}>
        {groups.map(([group, items]) => (
          <Box key={group}>
            <Text className="astraLabel" px="sm" pt="sm" pb={4}>{group}</Text>
            {items.map((path) => (
              <button
                key={path}
                type="button"
                className={classes.fileRow}
                data-active={path === selected || undefined}
                onClick={() => setSelection({ skillKey, path })}
                title={path}
              >
                <IconFile size={14} />
                <span>{path}</span>
              </button>
            ))}
          </Box>
        ))}
      </Paper>

      <Paper withBorder className={classes.filePreview}>
        <Group className={classes.filePreviewHeader} wrap="nowrap">
          <Text size="sm" fw={600} truncate="end" title={selected ?? undefined} style={{ flex: 1 }}>
            {selected}
          </Text>
          {fileUrl && (
            <>
              <Tooltip label="Open raw file in new tab">
                <ActionIcon component="a" href={fileUrl} target="_blank" rel="noreferrer noopener" variant="subtle" aria-label="Open raw file">
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Download">
                <ActionIcon component="a" href={fileUrl} download variant="subtle" aria-label="Download supporting file">
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
        <Box className={classes.filePreviewBody}>
          {query.isPending ? (
            <Center p="xl"><Loader size="sm" /></Center>
          ) : query.isError ? (
            <Stack align="center" gap="xs" p="lg">
              <Alert color="red" title="Could not load supporting file">
                {query.error.message}
              </Alert>
              <Button size="xs" variant="light" onClick={() => void query.refetch()}>Retry</Button>
            </Stack>
          ) : selected && query.data && fileUrl ? (
            <FilePreviewBody path={selected} data={query.data} fileUrl={fileUrl} />
          ) : null}
        </Box>
      </Paper>
    </div>
  );
}

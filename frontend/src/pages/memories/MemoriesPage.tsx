import {
  Alert, Badge, Button, Card, Code, Group, Loader, ScrollArea, SegmentedControl,
  SimpleGrid, Stack, Tabs, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { IconAlertCircle, IconFileText, IconFolder, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  getOpenVikingContent, getOpenVikingHealth, getOpenVikingStat, getOpenVikingStatus,
  getOpenVikingTree, getWorkingMemory, saveWorkingMemory, searchOpenViking,
} from '../../api/memory';
import { queryKeys } from '../../api/queryKeys';
import type { OpenVikingNode, OpenVikingSearchHit } from '../../api/types';
import { Markdown } from '../../components/Markdown';
import { ApiError } from '../../api/client';
import classes from './MemoriesPage.module.css';
import { parentVikingUri } from './memoryUri';

const ROOT = 'viking://user/default';
const PAGE_SIZE = 500;

function errorText(error: unknown) {
  return error instanceof ApiError && error.status === 503
    ? 'OpenViking is unreachable or not configured.'
    : 'Could not load OpenViking data.';
}

function nodeName(node: OpenVikingNode) {
  return node.name || node.uri.split('/').filter(Boolean).at(-1) || node.uri;
}

function isDirectory(node: OpenVikingNode) {
  return node.isDir === true || node.is_dir === true || node.type === 'directory' || node.type === 'dir';
}

function displayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['content', 'text', 'rendered', 'abstract', 'overview']) {
      if (typeof record[key] === 'string') return record[key];
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

function NodeRow({ node, selected, onChoose }: { node: OpenVikingNode; selected: boolean; onChoose: () => void }) {
  const stat = useQuery({
    queryKey: queryKeys.openviking.stat(node.uri),
    queryFn: ({ signal }) => getOpenVikingStat(node.uri, signal),
    retry: false,
    staleTime: 60_000,
  });
  const count = typeof stat.data?.count === 'number' ? stat.data.count : null;
  const directory = isDirectory(node);
  return (
    <Button
      variant={selected ? 'light' : 'subtle'}
      justify="space-between"
      fullWidth
      leftSection={directory ? <IconFolder size={16} /> : <IconFileText size={16} />}
      rightSection={count !== null ? <Badge size="xs" variant="light" color={count === 0 ? 'gray' : 'blue'}>{count}</Badge> : undefined}
      onClick={onChoose}
      aria-label={`${directory ? 'Open folder' : 'Open document'} ${nodeName(node)}${count !== null ? `, ${count} indexed` : ''}`}
    >
      <Text truncate size="sm">{nodeName(node)}</Text>
    </Button>
  );
}

function SearchHit({ hit }: { hit: OpenVikingSearchHit }) {
  const title = hit.title || hit.name || hit.uri || 'Untitled result';
  const body = hit.content || hit.text;
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} size="sm" truncate>{title}</Text>
        {typeof hit.score === 'number' && <Badge variant="light">{hit.score.toFixed(3)}</Badge>}
      </Group>
      {hit.uri && <Text size="xs" c="dimmed" className={classes.breakText}>{hit.uri}</Text>}
      {body && <Text size="sm" lineClamp={4} mt={4}>{body}</Text>}
    </Card>
  );
}

function SearchResults({ data }: { data: Awaited<ReturnType<typeof searchOpenViking>> }) {
  if (data.mode === 'fast') {
    const groups = [
      ['Memories', data.result.memories], ['Resources', data.result.resources], ['Skills', data.result.skills],
    ] as const;
    if (data.result.total === 0 || groups.every(([, hits]) => !hits?.length)) {
      return <Alert mt="sm" color="gray" title="Search completed">No indexed matches for this actor.</Alert>;
    }
    return <Stack mt="sm" gap="md">{groups.filter(([, hits]) => hits?.length).map(([label, hits]) => (
      <div key={label}><Text fw={700} size="sm" mb={4}>{label} ({hits.length})</Text><Stack gap="xs">{hits.map((hit, index) => <SearchHit key={hit.uri || `${label}-${index}`} hit={hit} />)}</Stack></div>
    ))}</Stack>;
  }
  const { entries = [], rendered, digest, stats } = data.result;
  if (!entries.length && !rendered && !digest) {
    return <Alert mt="sm" color="gray" title="Deep search completed">No context was found for this actor.</Alert>;
  }
  return <Stack mt="sm" gap="sm">
    {digest && <Card withBorder><Text fw={700} size="sm">Digest</Text><Text size="sm">{digest}</Text></Card>}
    {rendered && <Card withBorder><Text fw={700} size="sm" mb={4}>Rendered context</Text><Markdown>{rendered}</Markdown></Card>}
    {entries.length > 0 && <div><Text fw={700} size="sm" mb={4}>Entries ({entries.length})</Text><Stack gap="xs">{entries.map((hit, index) => <SearchHit key={hit.uri || `entry-${index}`} hit={hit} />)}</Stack></div>}
    {stats && <Code block>{JSON.stringify(stats, null, 2)}</Code>}
  </Stack>;
}

function StatusValue({ value }: { value: unknown }) {
  if (isEmpty(value)) return <Text size="sm" c="dimmed">Checked — no records reported.</Text>;
  if (typeof value !== 'object') return <Text size="sm">{String(value)}</Text>;
  return <Code block className={classes.statusCode}>{JSON.stringify(value, null, 2)}</Code>;
}

export default function MemoriesPage() {
  const [uri, setUri] = useState(ROOT);
  const [file, setFile] = useState<string | null>(null);
  const [contentOffset, setContentOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'fast' | 'deep'>('fast');
  const [working, setWorking] = useState('memory');
  const [draft, setDraft] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const tree = useQuery({ queryKey: queryKeys.openviking.tree(uri), queryFn: ({ signal }) => getOpenVikingTree(uri, signal) });
  const content = useQuery({
    queryKey: queryKeys.openviking.content(file ?? '', contentOffset),
    queryFn: ({ signal }) => getOpenVikingContent(file!, contentOffset, PAGE_SIZE, signal),
    enabled: !!file,
  });
  const health = useQuery({ queryKey: queryKeys.openviking.health(), queryFn: ({ signal }) => getOpenVikingHealth(signal), retry: false, refetchInterval: 30_000 });
  const status = useQuery({ queryKey: queryKeys.openviking.status(), queryFn: ({ signal }) => getOpenVikingStatus(signal), retry: false, enabled: health.isSuccess });
  const workingFiles = useQuery({ queryKey: ['memory', 'files'], queryFn: ({ signal }) => getWorkingMemory(signal) });
  const save = useMutation({ mutationFn: () => saveWorkingMemory(working, draft ?? workingFiles.data?.files[working] ?? ''), onSuccess: () => { setDraft(null); queryClient.invalidateQueries({ queryKey: ['memory', 'files'] }); } });
  const runSearch = useMutation({ mutationFn: () => searchOpenViking({ query: search, mode, target_uri: mode === 'fast' ? uri : undefined }) });
  const choose = (node: OpenVikingNode) => {
    if (isDirectory(node)) { setUri(node.uri); setFile(null); }
    else setFile(node.uri);
    setContentOffset(0);
  };
  const workingValue = draft ?? workingFiles.data?.files[working] ?? '';
  const documentText = displayText(content.data?.content);

  return <Tabs defaultValue="inspector" className={classes.tabs}>
    <Tabs.List><Tabs.Tab value="inspector">OpenViking inspector</Tabs.Tab><Tabs.Tab value="working">Working memory</Tabs.Tab></Tabs.List>
    <Tabs.Panel value="inspector" pt="md"><div className={classes.root}>
      <section className={classes.browser}>
        <Title order={3}>OpenViking</Title>
        <Text size="xs" c="dimmed" mt={4} className={classes.breakText}>{uri}</Text>
        <Button size="xs" variant="subtle" mt="xs" onClick={() => { setUri(parentVikingUri(uri)); setFile(null); setContentOffset(0); }} disabled={uri === 'viking://'}>Up one level</Button>
        <ScrollArea h="calc(100vh - 250px)" mt="sm">
          {tree.isLoading && <Loader size="sm" />}
          {tree.isError && <Alert color="red" icon={<IconAlertCircle />}>{errorText(tree.error)}</Alert>}
          {tree.data?.items.length === 0 && <Alert color="gray" title="Directory checked">This directory is empty.</Alert>}
          <Stack gap={2}>{tree.data?.items.map((node) => <NodeRow key={node.uri} node={node} selected={file === node.uri} onChoose={() => choose(node)} />)}</Stack>
        </ScrollArea>
      </section>
      <section className={classes.content}>
        <Card withBorder>
          <Group justify="space-between"><Title order={3}>{file ? nodeName({ name: '', uri: file }) : 'Select a document'}</Title>{file && <Badge color="blue">L0 / L1 / full text</Badge>}</Group>
          {content.isLoading && <Loader mt="md" />}
          {content.isError && <Alert mt="md" color="red">{errorText(content.error)}</Alert>}
          {content.data && <Tabs defaultValue="abstract" mt="md">
            <Tabs.List><Tabs.Tab value="abstract">Abstract (L0)</Tabs.Tab><Tabs.Tab value="overview">Overview (L1)</Tabs.Tab><Tabs.Tab value="document">Full document</Tabs.Tab></Tabs.List>
            <Tabs.Panel value="abstract" pt="sm">{displayText(content.data.abstract) ? <Text>{displayText(content.data.abstract)}</Text> : <Alert color="gray">Checked — abstract is empty.</Alert>}</Tabs.Panel>
            <Tabs.Panel value="overview" pt="sm">{displayText(content.data.overview) ? <Text>{displayText(content.data.overview)}</Text> : <Alert color="gray">Checked — overview is empty.</Alert>}</Tabs.Panel>
            <Tabs.Panel value="document" pt="sm">
              {documentText ? <Markdown>{documentText}</Markdown> : <Alert color="gray">Checked — this page is empty.</Alert>}
              <Group justify="space-between" mt="md">
                <Button variant="default" disabled={contentOffset === 0} onClick={() => setContentOffset(Math.max(0, contentOffset - PAGE_SIZE))}>Previous page</Button>
                <Text size="xs" c="dimmed">Items {contentOffset + 1}–{contentOffset + PAGE_SIZE}</Text>
                <Button variant="default" disabled={!documentText || content.data.hasMore === false} onClick={() => setContentOffset(contentOffset + PAGE_SIZE)}>Next page</Button>
              </Group>
            </Tabs.Panel>
          </Tabs>}
        </Card>
        <Card withBorder mt="md">
          <Group><TextInput className={classes.search} value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search this actor’s memories" onKeyDown={(e) => e.key === 'Enter' && search.trim() && runSearch.mutate()} /><SegmentedControl value={mode} onChange={(v) => setMode(v as 'fast' | 'deep')} data={[{ label: 'Fast', value: 'fast' }, { label: 'Deep context', value: 'deep' }]} /><Button leftSection={<IconSearch size={16}/>} onClick={() => runSearch.mutate()} loading={runSearch.isPending} disabled={!search.trim()}>Search</Button></Group>
          <Text size="xs" c="dimmed" mt="xs">Results are scoped to this actor. Fast search is limited to the current directory; deep context search spans actor-indexed memory. Archived sessions may be browsable but not searchable.</Text>
          {runSearch.isError && <Alert mt="sm" color="red">{errorText(runSearch.error)}</Alert>}
          {runSearch.data && <SearchResults data={runSearch.data} />}
        </Card>
        <Card withBorder mt="md">
          <Group justify="space-between"><Title order={4}>OpenViking status</Title>{health.data && <Badge color="green">Live</Badge>}</Group>
          {health.isLoading && <Loader size="sm" mt="sm" />}
          {health.isError && <Alert mt="sm" color="red" icon={<IconAlertCircle />} title="Backend unreachable">{errorText(health.error)}</Alert>}
          {health.data && <Text size="xs" c="dimmed" mt={4}>Liveness confirmed by /health and observer/system. The unreliable /ready endpoint is not used.</Text>}
          {status.isLoading && <Loader size="sm" mt="sm" />}
          {status.isError && <Alert mt="sm" color="yellow" title="Live, but status details failed">OpenViking responded to its liveness checks, but observer details could not be loaded.</Alert>}
          {status.data && <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm">
            {([['Queue depth', status.data.queue], ['Lock conflicts', status.data.lock], ['Vector database', status.data.vikingdb], ['Model usage', status.data.models], ['Retrieval quality', status.data.retrieval], ['Memory census', status.data.memories], ['Recent tasks', status.data.tasks], ['System', status.data.system]] as const).map(([label, value]) => <Card key={label} withBorder padding="sm"><Text fw={700} size="sm" mb={4}>{label}</Text><StatusValue value={value} /></Card>)}
          </SimpleGrid>}
        </Card>
      </section>
    </div></Tabs.Panel>
    <Tabs.Panel value="working" pt="md"><Card maw={1000} withBorder><Title order={3}>Working memory</Title><Text c="dimmed" size="sm" mt={4}>These Hermes files are separate from indexed OpenViking memories.</Text><Tabs value={working} onChange={(v) => { if (v) { setWorking(v); setDraft(null); } }} mt="md"><Tabs.List><Tabs.Tab value="memory">MEMORY.md</Tabs.Tab><Tabs.Tab value="user">USER.md</Tabs.Tab><Tabs.Tab value="soul">SOUL.md</Tabs.Tab></Tabs.List></Tabs>{workingFiles.isLoading ? <Loader mt="md" /> : workingFiles.isError ? <Alert mt="md" color="red">Could not load working-memory files.</Alert> : <><Textarea mt="md" minRows={18} value={workingValue} onChange={(e) => setDraft(e.currentTarget.value)} autosize styles={{ input: { fontFamily: 'monospace' } }} /><Group justify="flex-end" mt="sm"><Button onClick={() => save.mutate()} loading={save.isPending}>Save {working === 'soul' ? 'SOUL.md' : working === 'user' ? 'USER.md' : 'MEMORY.md'}</Button></Group>{save.isError && <Alert mt="sm" color="red">The file could not be saved. It may be disabled by Hermes configuration.</Alert>}</>}</Card></Tabs.Panel>
  </Tabs>;
}

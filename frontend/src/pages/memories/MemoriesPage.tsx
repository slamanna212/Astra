import { Alert, Badge, Button, Card, Code, Group, Loader, ScrollArea, SegmentedControl, Stack, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertCircle, IconFileText, IconFolder, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getOpenVikingContent, getOpenVikingStat, getOpenVikingStatus, getOpenVikingTree, getWorkingMemory, saveWorkingMemory, searchOpenViking } from '../../api/memory';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { OpenVikingNode } from '../../api/types';
import { Markdown } from '../../components/Markdown';
import { ApiError } from '../../api/client';
import classes from './MemoriesPage.module.css';

const ROOT = 'viking://user/default';
function errorText(error: unknown) { return error instanceof ApiError && error.status === 503 ? 'OpenViking is unreachable or not configured.' : 'Could not load OpenViking data.'; }
function nodeName(node: OpenVikingNode) { return node.name || node.uri.split('/').filter(Boolean).at(-1) || node.uri; }

export default function MemoriesPage() {
  const [uri, setUri] = useState(ROOT); const [file, setFile] = useState<string | null>(null); const [search, setSearch] = useState(''); const [mode, setMode] = useState<'fast' | 'deep'>('fast'); const [working, setWorking] = useState('memory'); const [draft, setDraft] = useState<string | null>(null); const queryClient = useQueryClient();
  const tree = useQuery({ queryKey: queryKeys.openviking.tree(uri), queryFn: ({ signal }) => getOpenVikingTree(uri, signal) });
  const content = useQuery({ queryKey: queryKeys.openviking.content(file ?? ''), queryFn: ({ signal }) => getOpenVikingContent(file!, signal), enabled: !!file });
  const status = useQuery({ queryKey: queryKeys.openviking.status(), queryFn: ({ signal }) => getOpenVikingStatus(signal), retry: false });
  const stat = useQuery({ queryKey: ['openviking', 'stat', uri], queryFn: ({ signal }) => getOpenVikingStat(uri, signal), retry: false });
  const workingFiles = useQuery({ queryKey: ['memory', 'files'], queryFn: ({ signal }) => getWorkingMemory(signal) });
  const save = useMutation({ mutationFn: () => saveWorkingMemory(working, draft ?? workingFiles.data?.files[working] ?? ''), onSuccess: () => { setDraft(null); queryClient.invalidateQueries({ queryKey: ['memory', 'files'] }); } });
  const runSearch = useMutation({ mutationFn: () => searchOpenViking({ query: search, mode }) });
  const choose = (node: OpenVikingNode) => node.isDir ? (setUri(node.uri), setFile(null)) : setFile(node.uri);
  const indexed = typeof stat.data?.count === 'number' ? stat.data.count : null;
  const workingValue = draft ?? workingFiles.data?.files[working] ?? '';
  return <Tabs defaultValue="inspector" className={classes.tabs}><Tabs.List><Tabs.Tab value="inspector">OpenViking inspector</Tabs.Tab><Tabs.Tab value="working">Working memory</Tabs.Tab></Tabs.List><Tabs.Panel value="inspector" pt="md"><div className={classes.root}>
    <section className={classes.browser}><Group justify="space-between"><Title order={3}>OpenViking</Title>{indexed !== null && <Badge variant="light">{indexed} indexed</Badge>}</Group><Text size="xs" c="dimmed" mt={4}>{uri}</Text><Button size="xs" variant="subtle" mt="xs" onClick={() => { const parent = uri.replace(/\/[^/]+\/?$/, '') || 'viking://'; setUri(parent); setFile(null); }} disabled={uri === 'viking://'}>Up one level</Button>
      <ScrollArea h="calc(100vh - 250px)" mt="sm">{tree.isLoading && <Loader size="sm" />}{tree.isError && <Alert color="red" icon={<IconAlertCircle />}>{errorText(tree.error)}</Alert>}<Stack gap={2}>{tree.data?.items.map((node) => <Button key={node.uri} variant={file === node.uri ? 'light' : 'subtle'} justify="flex-start" leftSection={node.isDir ? <IconFolder size={16} /> : <IconFileText size={16} />} onClick={() => choose(node)}>{nodeName(node)}</Button>)}</Stack></ScrollArea></section>
    <section className={classes.content}><Card withBorder><Group justify="space-between"><Title order={3}>{file ? nodeName({ name: '', uri: file, isDir: false }) : 'Select a document'}</Title>{file && <Badge color="blue">L0 / L1 / full text</Badge>}</Group>{content.isLoading && <Loader mt="md" />}{content.isError && <Alert mt="md" color="red">{errorText(content.error)}</Alert>}{content.data && <Stack mt="md"><Text fw={600}>Abstract (L0)</Text><Text>{content.data.abstract || 'Checked and empty.'}</Text><Text fw={600}>Overview (L1)</Text><Text>{content.data.overview || 'Checked and empty.'}</Text><Text fw={600}>Document</Text><Markdown content={content.data.content || 'Checked and empty.'} /></Stack>}</Card>
      <Card withBorder mt="md"><Group><TextInput className={classes.search} value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search this actor’s memories" onKeyDown={(e) => e.key === 'Enter' && search && runSearch.mutate()} /><SegmentedControl value={mode} onChange={(v) => setMode(v as 'fast' | 'deep')} data={[{ label: 'Fast', value: 'fast' }, { label: 'Deep context', value: 'deep' }]} /><Button leftSection={<IconSearch size={16}/>} onClick={() => runSearch.mutate()} loading={runSearch.isPending} disabled={!search}>Search</Button></Group><Text size="xs" c="dimmed" mt="xs">Results are scoped to this actor; archived sessions may be browsable but not searchable.</Text>{runSearch.isError && <Alert mt="sm" color="red">{errorText(runSearch.error)}</Alert>}{runSearch.data && <Code block mt="sm">{JSON.stringify(runSearch.data.result, null, 2)}</Code>}</Card>
      <Card withBorder mt="md"><Title order={4}>Status</Title>{status.isLoading && <Loader size="sm" mt="sm" />}{status.isError && <Alert mt="sm" color="red" icon={<IconAlertCircle />}>{errorText(status.error)}</Alert>}{status.data && <Stack gap={4} mt="sm"><Badge color="green" w="fit-content">Connected</Badge>{Object.entries(status.data).filter(([key]) => key !== 'reachable').map(([key, value]) => <div key={key}><Text fw={600} tt="capitalize">{key}</Text><Code block>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</Code></div>)}</Stack>}</Card>
    </section>
  </div></Tabs.Panel><Tabs.Panel value="working" pt="md"><Card maw={1000} withBorder><Title order={3}>Working memory</Title><Text c="dimmed" size="sm" mt={4}>These Hermes files are separate from indexed OpenViking memories.</Text><Tabs value={working} onChange={(v) => { if (v) { setWorking(v); setDraft(null); } }} mt="md"><Tabs.List><Tabs.Tab value="memory">MEMORY.md</Tabs.Tab><Tabs.Tab value="user">USER.md</Tabs.Tab><Tabs.Tab value="soul">SOUL.md</Tabs.Tab></Tabs.List></Tabs>{workingFiles.isLoading ? <Loader mt="md" /> : workingFiles.isError ? <Alert mt="md" color="red">Could not load working-memory files.</Alert> : <><Textarea mt="md" minRows={18} value={workingValue} onChange={(e) => setDraft(e.currentTarget.value)} autosize styles={{ input: { fontFamily: 'monospace' } }} /><Group justify="flex-end" mt="sm"><Button onClick={() => save.mutate()} loading={save.isPending}>Save {working === 'soul' ? 'SOUL.md' : working === 'user' ? 'USER.md' : 'MEMORY.md'}</Button></Group>{save.isError && <Alert mt="sm" color="red">The file could not be saved. It may be disabled by Hermes configuration.</Alert>}</>}</Card></Tabs.Panel></Tabs>;
}

import { ActionIcon, Badge, Button, Center, Group, Loader, Modal, Stack, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { listSkills, saveSkill } from '../../api/skills';
import { queryKeys } from '../../api/queryKeys';
import type { SkillSummary } from '../../api/types';
import classes from './SkillList.module.css';

function SkillRow({ skill, active }: { skill: SkillSummary; active: boolean }) {
  // API routes address the on-disk directory, while frontmatter `name` is only a
  // display label and is allowed to differ from that directory.
  const pathName = skill.path.split('/').filter(Boolean).at(-1) ?? skill.name;
  const to = skill.category
    ? `/skills/${encodeURIComponent(skill.category)}/${encodeURIComponent(pathName)}`
    : `/skills/${encodeURIComponent(pathName)}`;
  return (
    <Link to={to} className={classes.row} data-active={active || undefined}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} truncate="end">
          {skill.name}
        </Text>
        {!skill.enabled && (
          <Badge size="xs" color="gray" variant="outline">
            disabled
          </Badge>
        )}
      </Group>
      <Text size="xs" c="dimmed" truncate="end">
        {skill.description || 'No description'}
      </Text>
    </Link>
  );
}

export function SkillList({
  selectedCategory,
  selectedName,
}: {
  selectedCategory: string | null;
  selectedName: string | null;
}) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newContent, setNewContent] = useState('---\ndescription: Describe when this skill should be used.\n---\n\n# Instructions\n\n');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.skills.list(),
    queryFn: ({ signal }) => listSkills(signal),
  });
  const create = useMutation({
    mutationFn: () => saveSkill(newCategory.trim() || null, newName, newContent),
    onSuccess: () => {
      const name = newName.trim().toLowerCase().replaceAll(' ', '-');
      const category = newCategory.trim().toLowerCase().replaceAll(' ', '-');
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
      notifications.show({ color: 'green', message: `Created ${name}` });
      void navigate(category ? `/skills/${encodeURIComponent(category)}/${encodeURIComponent(name)}` : `/skills/${encodeURIComponent(name)}`);
    },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not create skill', message: error.message }),
  });

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q),
    );
  }, [query.data, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, SkillSummary[]>();
    for (const skill of filtered) {
      const key = skill.category ?? 'Uncategorized';
      const list = map.get(key) ?? [];
      list.push(skill);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <Stack gap={0} h="100%">
      <Stack gap="xs" px="md" py="sm" style={{ borderBottom: '1px solid var(--astra-border)', background: 'var(--astra-bg-chrome)' }}>
        <Group justify="space-between">
          <Title order={3}>Skills</Title>
          <Group gap="xs">
            {query.data && (
              <Text ff="monospace" fz={11} c="dimmed">
                {filtered.length} / {query.data.items.length}
              </Text>
            )}
            <Tooltip label="Create skill"><ActionIcon aria-label="Create skill" onClick={() => setCreating(true)}><IconPlus size={16} /></ActionIcon></Tooltip>
          </Group>
        </Group>
        <TextInput
          placeholder="Search skills…"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Stack>
      <div className={classes.scroller}>
        {query.isLoading && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}
        {query.isError && (
          <Text c="red" size="sm" p="md">
            {query.error.message}
          </Text>
        )}
        {grouped.map(([category, skills]) => (
          <div key={category}>
            <div className={`${classes.categoryLabel} astraLabel`}>{category}</div>
            {skills.map((skill) => (
              <SkillRow
                key={`${skill.category ?? ''}/${skill.name}`}
                skill={skill}
                active={(skill.path.split('/').filter(Boolean).at(-1) ?? skill.name) === selectedName && (skill.category ?? null) === selectedCategory}
              />
            ))}
          </div>
        ))}
        {query.data && filtered.length === 0 && (
          <Text c="dimmed" size="sm" p="md">
            No skills match “{search}”.
          </Text>
        )}
      </div>
      <Modal opened={creating} onClose={() => setCreating(false)} title="Create skill" size="lg">
        <Stack>
          <TextInput required label="Name" description="Spaces are normalized to hyphens" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
          <TextInput label="Category" description="Optional; spaces are normalized to hyphens" value={newCategory} onChange={(e) => setNewCategory(e.currentTarget.value)} />
          <Textarea required label="SKILL.md" minRows={16} autosize value={newContent} onChange={(e) => setNewContent(e.currentTarget.value)} styles={{ input: { fontFamily: 'monospace' } }} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={!newName.trim() || !newContent.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create skill</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

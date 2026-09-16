import { Badge, Center, Group, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { listSkills } from '../../api/skills';
import { queryKeys } from '../../api/queryKeys';
import type { SkillSummary } from '../../api/types';
import classes from './SkillList.module.css';

function SkillRow({ skill, active }: { skill: SkillSummary; active: boolean }) {
  const to = skill.category
    ? `/skills/${encodeURIComponent(skill.category)}/${encodeURIComponent(skill.name)}`
    : `/skills/${encodeURIComponent(skill.name)}`;
  return (
    <Link to={to} className={classes.row} data-active={active || undefined}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} truncate="end">
          {skill.name}
        </Text>
        {!skill.enabled && (
          <Badge size="xs" color="gray" variant="light">
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
  const query = useQuery({
    queryKey: queryKeys.skills.list(),
    queryFn: ({ signal }) => listSkills(signal),
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
      <Stack gap="xs" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between">
          <Title order={4}>Skills</Title>
          {query.data && (
            <Text size="xs" c="dimmed">
              {filtered.length} / {query.data.items.length}
            </Text>
          )}
        </Group>
        <TextInput
          size="xs"
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
            <div className={classes.categoryLabel}>
              <Text size="xs" tt="uppercase" c="dimmed">
                {category}
              </Text>
            </div>
            {skills.map((skill) => (
              <SkillRow
                key={`${skill.category ?? ''}/${skill.name}`}
                skill={skill}
                active={skill.name === selectedName && (skill.category ?? null) === selectedCategory}
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
    </Stack>
  );
}

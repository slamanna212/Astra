import { Alert, Badge, Center, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconFileText } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { getSkill } from '../../api/skills';
import { queryKeys } from '../../api/queryKeys';
import { Markdown } from '../../components/Markdown';
import classes from './SkillDetail.module.css';

/** Displays the canonical SKILL.md returned by the backend. Editing is deliberately Phase 3. */
export default function SkillDetail() {
  const { category, name } = useParams();
  const selectedCategory = category ?? null;
  const query = useQuery({
    queryKey: queryKeys.skills.detail(selectedCategory, name ?? ''),
    queryFn: ({ signal }) => getSkill(selectedCategory, name ?? '', signal),
    enabled: Boolean(name),
  });

  if (query.isPending) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Center h="100%" p="md">
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Failed to load skill">
          {query.error.message}
        </Alert>
      </Center>
    );
  }
  const skill = query.data;
  if (!skill) return null;

  return (
    <Stack className={classes.root} p="md" gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Group gap="xs">
            <Title order={3}>{skill.name}</Title>
            <Badge color={skill.enabled ? 'blue' : 'gray'} variant="light">
              {skill.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </Group>
          {skill.category && (
            <Text size="sm" c="dimmed">
              {skill.category}
            </Text>
          )}
          {skill.description && <Text size="sm">{skill.description}</Text>}
        </div>
        <IconFileText size={22} color="var(--mantine-color-dimmed)" />
      </Group>

      {skill.tags.length > 0 && (
        <Group gap={6}>
          {skill.tags.map((tag) => (
            <Badge key={tag} size="sm" variant="outline">
              {tag}
            </Badge>
          ))}
        </Group>
      )}

      <Paper withBorder radius="md" p="md" className={classes.content}>
        <Markdown>{skill.content}</Markdown>
      </Paper>
    </Stack>
  );
}

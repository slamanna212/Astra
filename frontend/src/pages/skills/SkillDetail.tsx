import { Alert, Badge, Button, Center, Group, Loader, Paper, Stack, Switch, Tabs, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconFileText, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { deleteSkill, getSkill, saveSkill, setSkillEnabled } from '../../api/skills';
import { queryKeys } from '../../api/queryKeys';
import { Markdown } from '../../components/Markdown';
import classes from './SkillDetail.module.css';
import { SkillFiles } from './SkillFiles';

export default function SkillDetail() {
  const { category, name } = useParams();
  const selectedCategory = category ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const skillKey = `${selectedCategory ?? ''}/${name ?? ''}`;
  const [draftState, setDraftState] = useState<{ key: string; content: string } | null>(null);
  const query = useQuery({
    queryKey: queryKeys.skills.detail(selectedCategory, name ?? ''),
    queryFn: ({ signal }) => getSkill(selectedCategory, name ?? '', signal),
    enabled: Boolean(name),
  });
  const draft = draftState?.key === skillKey ? draftState.content : null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
  const save = useMutation({
    mutationFn: (content: string) => saveSkill(selectedCategory, name ?? '', content),
    onSuccess: () => { setDraftState(null); refresh(); notifications.show({ color: 'green', message: 'Skill saved' }); },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not save skill', message: error.message }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setSkillEnabled(selectedCategory, name ?? '', enabled),
    onSuccess: refresh,
    onError: (error) => notifications.show({ color: 'red', title: 'Could not change skill state', message: error.message }),
  });
  const remove = useMutation({
    mutationFn: () => deleteSkill(selectedCategory, name ?? ''),
    onSuccess: () => { refresh(); notifications.show({ color: 'green', message: 'Skill deleted' }); void navigate('/skills'); },
    onError: (error) => notifications.show({ color: 'red', title: 'Could not delete skill', message: error.message }),
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
            <Badge color={skill.enabled ? 'teal' : 'gray'} variant="light">
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
        <Group gap="sm">
          <Switch
            label={skill.enabled ? 'Enabled' : 'Disabled'}
            checked={skill.enabled}
            disabled={toggle.isPending}
            onChange={(event) => toggle.mutate(event.currentTarget.checked)}
          />
          <Button
            color="red"
            variant="subtle"
            size="xs"
            leftSection={<IconTrash size={15} />}
            loading={remove.isPending}
            onClick={() => { if (window.confirm(`Delete skill “${skill.name}” and its directory?`)) remove.mutate(); }}
          >Delete</Button>
          <IconFileText size={22} color="var(--astra-text-dim)" />
        </Group>
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

      <Tabs defaultValue="preview">
        <Tabs.List>
          <Tabs.Tab value="preview">Preview</Tabs.Tab>
          <Tabs.Tab value="edit">Edit SKILL.md</Tabs.Tab>
          <Tabs.Tab value="files">Files ({skill.files.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="preview" pt="md">
          <Paper p="md" className={classes.content}><Markdown>{draft ?? skill.content}</Markdown></Paper>
        </Tabs.Panel>
        <Tabs.Panel value="edit" pt="md">
          <Textarea minRows={20} autosize value={draft ?? skill.content} onChange={(event) => setDraftState({ key: skillKey, content: event.currentTarget.value })} styles={{ input: { fontFamily: 'monospace' } }} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" disabled={draft === null} onClick={() => setDraftState(null)}>Discard</Button>
            <Button disabled={draft === null || !draft.trim()} loading={save.isPending} onClick={() => save.mutate(draft ?? skill.content)}>Save SKILL.md</Button>
          </Group>
        </Tabs.Panel>
        <Tabs.Panel value="files" pt="md">
          <SkillFiles category={selectedCategory} name={name ?? ''} files={skill.files} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

import {
  Alert,
  Autocomplete,
  Button,
  Divider,
  FileButton,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  clearAvatar,
  createProfile,
  listProfiles,
  deleteProfile,
  duplicateProfile,
  getModelOptions,
  updateProfile,
  uploadAvatar,
  type ProfileDetail,
} from '../../api/profiles';
import { queryKeys } from '../../api/queryKeys';
import { currentProfile, pathForProfile } from '../../lib/profileScope';
import { BotAvatar } from '../../components/BotAvatar';
import classes from './BotEditor.module.css';

interface BotEditorProps {
  opened: boolean;
  onClose: () => void;
  /** Present when editing an existing bot. */
  profile?: ProfileDetail | null;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function BotEditor({ opened, onClose, profile }: BotEditorProps) {
  const editing = Boolean(profile);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [soul, setSoul] = useState('');
  const [model, setModel] = useState('');
  const [section, setSection] = useState('');
  const [hidden, setHidden] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setName(profile?.name ?? '');
    setTitle(profile?.title ?? '');
    setDescription(profile?.description ?? '');
    setSoul(profile?.soul ?? '');
    setModel(profile?.model ?? '');
    setSection(profile?.section ?? '');
    setHidden(profile?.hidden ?? false);
    setCloneFrom(null);
  }, [opened, profile]);

  const options = useQuery({
    queryKey: queryKeys.profiles.modelOptions(profile?.name ?? currentProfile),
    queryFn: ({ signal }) => getModelOptions(profile?.name ?? currentProfile, signal),
    enabled: opened,
    staleTime: 60_000,
  });

  const roster = useQuery({
    queryKey: queryKeys.profiles.list,
    queryFn: ({ signal }) => listProfiles(signal),
    enabled: opened && !editing,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (editing && profile) {
        return updateProfile(profile.name, {
          title: title.trim() || null,
          description: description.trim() || null,
          soul,
          model: model.trim() || null,
          section: section.trim() || null,
          hidden,
        });
      }
      return createProfile({
        name: name.trim(),
        title: title.trim() || null,
        description: description.trim() || null,
        soul,
        model: model.trim() || null,
        clone_from: cloneFrom,
      });
    },
    onSuccess: (saved) => {
      invalidate();
      notifications.show({
        color: 'green',
        message: editing ? `${saved.title} updated` : `${saved.title} is ready`,
      });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAvatar(profile?.name ?? name, file),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: 'Profile picture updated' });
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeAvatar = useMutation({
    mutationFn: () => clearAvatar(profile?.name ?? name),
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const duplicate = useMutation({
    mutationFn: () => duplicateProfile(profile?.name ?? '', { name: `${profile?.name ?? ''}-copy` }),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: 'Bot duplicated' });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteProfile(profile?.name ?? ''),
    onSuccess: () => {
      invalidate();
      onClose();
      // The bot being deleted may be the one this document belongs to.
      if (profile?.name === currentProfile) window.location.assign('/');
    },
    onError: (err: Error) => setError(err.message),
  });

  const nameError =
    !editing && name && !NAME_PATTERN.test(name.trim())
      ? 'Lowercase letters, numbers, dashes and underscores only'
      : null;
  const canSave = editing ? true : NAME_PATTERN.test(name.trim()) && !nameError;

  const preview = {
    name: (profile?.name ?? name) || 'new-bot',
    title: title || name || 'New bot',
    avatar_url: profile?.avatar_url ?? null,
    updated_at: profile?.updated_at ?? null,
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? `Edit ${profile?.title}` : 'New bot'}
      size="lg"
      centered
      classNames={{ title: classes.modalTitle }}
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light" onClose={() => setError(null)} withCloseButton>
            {error}
          </Alert>
        )}

        <Group gap="md" align="center">
          <BotAvatar profile={preview} size={64} />
          <Stack gap={6}>
            <Group gap="xs">
              <FileButton
                accept="image/png,image/jpeg,image/webp"
                onChange={(file) => {
                  if (!file) return;
                  if (!editing && !canSave) {
                    setError('Name this bot first, then add a picture');
                    return;
                  }
                  upload.mutate(file);
                }}
              >
                {(props) => (
                  <Button
                    {...props}
                    variant="light"
                    size="xs"
                    leftSection={<IconUpload size={14} />}
                    loading={upload.isPending}
                    disabled={!editing && !NAME_PATTERN.test(name.trim())}
                  >
                    {preview.avatar_url ? 'Replace picture' : 'Upload picture'}
                  </Button>
                )}
              </FileButton>
              {preview.avatar_url && (
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={() => removeAvatar.mutate()}
                  loading={removeAvatar.isPending}
                >
                  Remove
                </Button>
              )}
            </Group>
            <Text fz={11} c="dimmed">
              PNG, JPEG or WebP, up to 2 MB.
            </Text>
          </Stack>
        </Group>

        {!editing && (
          <>
            <TextInput
              label="Name"
              description="Used for the folder and URL; cannot change later"
              placeholder="researcher"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={nameError}
              required
              data-autofocus
            />
            <Autocomplete
              label="Copy settings from"
              description="Optional: start from another bot's model, skills and configuration"
              placeholder="default"
              data={(roster.data?.items ?? []).map((row) => row.name).filter((row) => row !== name)}
              value={cloneFrom ?? ''}
              onChange={(value) => setCloneFrom(value.trim() || null)}
            />
          </>
        )}

        <TextInput
          label="Display name"
          placeholder="Researcher"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          label="What this bot does"
          placeholder="Digs through papers and reports back with citations."
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={4}
        />
        <Autocomplete
          label="Model"
          description="Leave empty to use the profile's configured default"
          placeholder={options.data?.model ?? 'inherit'}
          data={[options.data?.model ?? '', ...(options.data?.aliases ?? []).map((a) => a.alias ?? '')].filter(Boolean)}
          value={model}
          onChange={setModel}
        />
        <Textarea
          label="Instructions"
          description="Saved as this bot's SOUL.md — how it should think and behave"
          placeholder="You are a meticulous researcher…"
          value={soul}
          onChange={(event) => setSoul(event.currentTarget.value)}
          autosize
          minRows={4}
          maxRows={12}
          classNames={{ input: classes.soul }}
        />

        {editing && (
          <>
            <Divider label="Placement" labelPosition="left" />
            <TextInput
              label="Section"
              description="Optional grouping on the Bots page"
              placeholder="Work"
              value={section}
              onChange={(event) => setSection(event.currentTarget.value)}
            />
            <Switch
              label="Hide from the roster"
              description="Still reachable by URL and by the bots it manages"
              checked={hidden}
              onChange={(event) => setHidden(event.currentTarget.checked)}
            />
          </>
        )}

        <Group justify="space-between" mt="xs">
          <Group gap="xs">
            {editing && !profile?.is_default && (
              <>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={() => duplicate.mutate()}
                  loading={duplicate.isPending}
                >
                  Duplicate
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  leftSection={<IconTrash size={14} />}
                  loading={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${profile?.title}? Its chats, skills and memory go with it.`)) {
                      remove.mutate();
                    }
                  }}
                >
                  Delete
                </Button>
              </>
            )}
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
              {editing ? 'Save' : 'Create bot'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

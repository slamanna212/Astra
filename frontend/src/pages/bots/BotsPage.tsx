import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPlus, IconSparkles } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getProfile, listProfiles, type ProfileDetail, type ProfileSummary } from '../../api/profiles';
import { queryKeys } from '../../api/queryKeys';
import { BotAvatar } from '../../components/BotAvatar';
import { currentProfile, pathForProfile } from '../../lib/profileScope';
import { BotEditor } from './BotEditor';
import classes from './BotsPage.module.css';

/**
 * The Bots roster: one card per profile, with its picture, what it does and whether it has
 * something new to say. Clicking a card opens that bot's canonical Bot Chat — the same
 * conversation every time, in that bot's own Hermes home.
 */
export default function BotsPage() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileDetail | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // `/bots?new=1` (from the composer picker) opens the create sheet directly.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null);
    setEditorOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const roster = useQuery({
    queryKey: queryKeys.profiles.list,
    queryFn: ({ signal }) => listProfiles(signal),
    refetchOnWindowFocus: true,
  });

  const openEditor = useMutation({
    mutationFn: (name: string) => getProfile(name),
    onSuccess: (detail) => {
      setEditing(detail);
      setEditorOpen(true);
    },
    onError: (err: Error) => notifications.show({ color: 'red', message: err.message }),
  });

  const profiles = (roster.data?.items ?? []).filter((row) => !row.hidden || row.name === currentProfile);
  const sections = groupBySection(profiles);

  return (
    <Box className={classes.root}>
      <Group justify="space-between" align="flex-end" mb="lg" wrap="nowrap">
        <Stack gap={2}>
          <Title order={2} className={classes.title}>
            Bots
          </Title>
          <Text fz={13} c="dimmed">
            Each bot has its own memory, skills and model. Pick one to talk to.
          </Text>
        </Stack>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          New bot
        </Button>
      </Group>

      {roster.isPending ? (
        <Center h={200}>
          <Loader size="sm" />
        </Center>
      ) : roster.isError ? (
        <Center h={200}>
          <Text c="red" fz={13}>
            Could not load bots: {(roster.error as Error).message}
          </Text>
        </Center>
      ) : profiles.length === 0 ? (
        <Center h={200}>
          <Text c="dimmed" fz={13}>
            No bots yet.
          </Text>
        </Center>
      ) : (
        <Stack gap="xl">
          {sections.map(([section, rows]) => (
            <Box key={section ?? 'all'}>
              {section && (
                <Text className={classes.sectionLabel} mb="xs">
                  {section}
                </Text>
              )}
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="sm">
                {rows.map((row) => (
                  <BotCard
                    key={row.name}
                    profile={row}
                    active={row.name === currentProfile}
                    onEdit={() => openEditor.mutate(row.name)}
                  />
                ))}
              </SimpleGrid>
            </Box>
          ))}
        </Stack>
      )}

      <BotEditor opened={editorOpen} onClose={() => setEditorOpen(false)} profile={editing} />
    </Box>
  );
}

function groupBySection(rows: ProfileSummary[]): [string | null, ProfileSummary[]][] {
  const groups = new Map<string | null, ProfileSummary[]>();
  for (const row of rows) {
    const key = row.section?.trim() || null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });
}

interface BotCardProps {
  profile: ProfileSummary;
  active: boolean;
  onEdit: () => void;
}

function BotCard({ profile, active, onEdit }: BotCardProps) {
  const target = pathForProfile(profile.name, '/bots/chat');

  return (
    <Box className={classes.card} data-active={active || undefined} data-bot={profile.name}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        {active ? (
          // Same profile: an ordinary in-document route change.
          <Link to="/bots/chat" className={classes.avatarLink} aria-label={`Open ${profile.title}`}>
            <BotAvatar profile={profile} size={44} busy={profile.running} />
          </Link>
        ) : (
          // Another profile: a new document, so no cache, promise or stream can cross over.
          <a href={target} className={classes.avatarLink} aria-label={`Open ${profile.title}`}>
            <BotAvatar profile={profile} size={44} busy={profile.running} />
          </a>
        )}
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap" justify="space-between">
            <Text className={classes.botName} truncate>
              {profile.title}
            </Text>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Actions for ${profile.title}`}>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component="a" href={target}>
                  Open chat
                </Menu.Item>
                <Menu.Item onClick={onEdit}>Edit bot</Menu.Item>
                {!active && !profile.is_default && (
                  <Menu.Item component="a" href={pathForProfile(profile.name, '/settings')}>
                    Settings
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Text className={classes.botDescription} lineClamp={2}>
            {profile.description || (profile.is_default ? 'The original assistant' : 'No description yet')}
          </Text>
        </Box>
      </Group>

      <Group gap={6} mt="sm" wrap="nowrap" justify="space-between">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {profile.model && (
            <Badge size="xs" variant="light" color="gray" className={classes.modelBadge} title={profile.model}>
              {shortModel(profile.model)}
            </Badge>
          )}
          {profile.is_default && (
            <Badge size="xs" variant="outline" color="gray">
              home
            </Badge>
          )}
          {profile.credentials_ready === false && (
            <Tooltip label="No provider credentials yet — this bot cannot answer until a key is available">
              <Badge size="xs" variant="light" color="yellow">
                no key
              </Badge>
            </Tooltip>
          )}
        </Group>
        <Group gap={6} wrap="nowrap">
          {profile.unread && <span className={classes.unreadDot} aria-label="New messages" />}
          {profile.running && (
            <Tooltip label="Working on a turn">
              <span className={classes.working} aria-label="Working">
                <IconSparkles size={12} />
              </span>
            </Tooltip>
          )}
        </Group>
      </Group>

      {profile.preview && <Text className={classes.preview}>{profile.preview}</Text>}
    </Box>
  );
}

function shortModel(model: string): string {
  const tail = model.includes('/') ? model.split('/').pop() ?? model : model;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
}

import { ActionIcon, Anchor, Box, Center, Group, Loader, Menu, Text } from '@mantine/core';
import { IconDots, IconPencil, IconUsers } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ensureBotChat, getProfile, markBotRead, type ProfileDetail } from '../../api/profiles';
import { queryKeys } from '../../api/queryKeys';
import { BotAvatar } from '../../components/BotAvatar';
import { currentProfile } from '../../lib/profileScope';
import SessionPane from '../chats/SessionPane';
import { BotEditor } from './BotEditor';
import classes from './BotChatPage.module.css';

/**
 * A bot's canonical conversation. One session per profile, reused on every visit — the bot's
 * standing conversation rather than a fresh thread each time. `/new` inside it compacts the
 * conversation in place instead of forking, so context accumulates where you expect it to.
 */
export default function BotChatPage() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: queryKeys.profiles.detail(currentProfile),
    queryFn: ({ signal }) => getProfile(currentProfile, signal),
  });

  useEffect(() => {
    let cancelled = false;
    ensureBotChat(currentProfile)
      .then((result) => {
        if (cancelled) return;
        setSessionId(result.session_id);
        // Opening the conversation is what clears its unread marker.
        return markBotRead(currentProfile).then(() =>
          queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const detail = profile.data as ProfileDetail | undefined;

  return (
    <Box className={classes.root}>
      <header className={classes.header}>
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {detail ? (
            <BotAvatar profile={detail} size={34} busy={detail.running} />
          ) : (
            <Box className={classes.avatarPlaceholder} />
          )}
          <Box style={{ minWidth: 0 }}>
            <Text className={classes.name} truncate>
              {detail?.title ?? 'Bot'}
            </Text>
            <Text className={classes.subtitle} truncate>
              {detail?.running ? 'Working on a turn…' : (detail?.description || 'Bot Chat')}
            </Text>
          </Box>
        </Group>
        <Group gap={4} wrap="nowrap">
          <ActionIcon
            component={Link}
            to="/bots"
            variant="subtle"
            color="gray"
            aria-label="All bots"
            title="All bots"
          >
            <IconUsers size={17} stroke={1.5} />
          </ActionIcon>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Bot actions">
                <IconDots size={17} stroke={1.5} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => setEditorOpen(true)}>
                Edit bot
              </Menu.Item>
              <Menu.Item component={Link} to="/memories">
                Memory
              </Menu.Item>
              <Menu.Item component={Link} to="/skills">
                Skills
              </Menu.Item>
              <Menu.Item component={Link} to="/settings">
                Settings
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </header>

      <div className={classes.chat}>
        {error ? (
          <Center h="100%">
            <Box>
              <Text c="red" fz={13} ta="center">
                {error}
              </Text>
              <Anchor component={Link} to="/bots" fz={13} mt="xs" style={{ display: 'block', textAlign: 'center' }}>
                Back to bots
              </Anchor>
            </Box>
          </Center>
        ) : sessionId ? (
          <SessionPane sessionId={sessionId} />
        ) : (
          <Center h="100%">
            <Loader size="sm" />
          </Center>
        )}
      </div>

      <BotEditor opened={editorOpen} onClose={() => setEditorOpen(false)} profile={detail ?? null} />
    </Box>
  );
}

import { Box, Divider, Group, Menu, Skeleton, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconCheck, IconChevronDown, IconPlus, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { listProfiles, type ProfileSummary } from '../api/profiles';
import { queryKeys } from '../api/queryKeys';
import { currentProfile, switchProfile } from '../lib/profileScope';
import { BotAvatar } from './BotAvatar';
import classes from './BotPicker.module.css';

/**
 * Which bot answers the next message. This lives in the composer because that is the moment
 * the choice matters — same place the reference UI puts it.
 *
 * Picking another bot loads that bot's own document (and its Bot Chat). Nothing from the
 * current profile's caches, drafts or streams can follow you across.
 */
export function BotPicker({ compact = false }: { compact?: boolean }) {
  const roster = useQuery({
    queryKey: queryKeys.profiles.list,
    queryFn: ({ signal }) => listProfiles(signal),
    staleTime: 30_000,
  });

  const profiles = (roster.data?.items ?? []).filter((row) => !row.hidden || row.name === currentProfile);
  const active = profiles.find((row) => row.name === currentProfile);

  const pick = (row: ProfileSummary) => {
    if (row.name === currentProfile) return;
    switchProfile(row.name, '/bots/chat', '');
  };

  return (
    <Menu position="top-start" offset={8} radius="md" width={280} withinPortal shadow="md">
      <Menu.Target>
        <UnstyledButton className={classes.trigger} aria-label="Switch bot" data-compact={compact || undefined}>
          {active ? (
            <BotAvatar profile={active} size={compact ? 18 : 20} busy={active.running} />
          ) : (
            <Skeleton circle height={compact ? 18 : 20} width={compact ? 18 : 20} />
          )}
          {!compact && (
            <Text className={classes.name} truncate>
              {active?.title ?? currentProfile}
            </Text>
          )}
          {!compact && <IconChevronDown size={12} className={classes.chevron} />}
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown p={6}>
        <Text className={classes.label}>Answering as</Text>
        {profiles.map((row) => (
          <Menu.Item
            key={row.name}
            onClick={() => pick(row)}
            leftSection={<BotAvatar profile={row} size={22} busy={row.running} />}
            rightSection={
              row.name === currentProfile ? (
                <IconCheck size={14} className={classes.check} />
              ) : row.unread ? (
                <span className={classes.unread} aria-label="New messages" />
              ) : null
            }
            classNames={{ item: classes.row, itemLabel: classes.rowLabel }}
          >
            <Box>
              <Text className={classes.rowTitle} truncate>
                {row.title}
              </Text>
              <Text className={classes.rowMeta} truncate>
                {row.description || (row.is_default ? 'home' : row.name)}
              </Text>
            </Box>
          </Menu.Item>
        ))}
        <Divider my={4} />
        <Menu.Item component={Link} to="/bots" leftSection={<IconUsers size={15} />}>
          All bots
        </Menu.Item>
        <Menu.Item component={Link} to="/bots?new=1" leftSection={<IconPlus size={15} />}>
          New bot
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Compact variant used in the phone control row: the avatar alone, tooltip on long press. */
export function BotPickerIcon() {
  return (
    <Tooltip label="Change bot" openDelay={300}>
      <Group gap={0} wrap="nowrap" className={classes.iconWrap}>
        <BotPicker compact />
      </Group>
    </Tooltip>
  );
}

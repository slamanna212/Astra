import { Anchor, Badge, Box, Code, Group, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { SkillCommandExchange } from '../../../lib/skillSlashCommand';
import classes from './Transcript.module.css';

function skillHref(path: string): string {
  return `/skills/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
}

export function SkillCommandResult({ exchange }: { exchange: SkillCommandExchange }) {
  return (
    <Stack gap="sm">
      <Group justify="flex-end">
        <Box className={classes.userBubble}>
          <Text size="sm" ff="monospace">{exchange.command}</Text>
        </Box>
      </Group>
      <Box className={classes.localCommandResult}>
        {exchange.error ? (
          <Text size="sm" c="red">Failed to load skills: {exchange.error}</Text>
        ) : exchange.matchCount === 0 ? (
          <Text size="sm">
            {exchange.query ? `No skills matching “${exchange.query}”.` : 'No skills found.'}
          </Text>
        ) : (
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={600}>
                {exchange.query ? `Skills matching “${exchange.query}”` : 'Available skills'}
              </Text>
              <Badge size="xs" variant="light">{exchange.matchCount}</Badge>
            </Group>
            {exchange.groups.map((group) => (
              <Box key={group.category}>
                <Text className="astraLabel" mb={4}>{group.category}</Text>
                <Stack gap={4}>
                  {group.skills.map((skill) => (
                    <Group key={`${skill.category ?? ''}/${skill.path}`} gap="xs" align="baseline" wrap="nowrap">
                      <Anchor component={Link} to={skillHref(skill.path)} size="sm">
                        <Code>{skill.name}</Code>
                      </Anchor>
                      {!skill.enabled && <Badge size="xs" color="gray" variant="outline">disabled</Badge>}
                      {skill.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          — {skill.description.length > 80 ? `${skill.description.slice(0, 80)}…` : skill.description}
                        </Text>
                      )}
                    </Group>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

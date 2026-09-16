import { Box, Group, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { Spotlight, type SpotlightActionData } from '@mantine/spotlight';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { search } from '../api/search';
import { queryKeys } from '../api/queryKeys';
import { formatDateTime } from '../lib/format';
import { SourceBadge } from './SourceBadge';
import { Snippet } from './Snippet';

const DEBOUNCE_MS = 250;

/** Ctrl/Cmd+K global search over conversations (BUILD-SPEC §5's Spotlight requirement). Snippets
 * come from the backend already marked with sentinel characters — rendered via <Snippet>, never
 * dangerouslySetInnerHTML. */
export function SearchSpotlight() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmed = debounced.trim();

  const results = useQuery({
    queryKey: queryKeys.search.query(trimmed, null),
    queryFn: ({ signal }) => search({ q: trimmed, limit: 15 }, signal),
    enabled: trimmed.length > 0,
  });

  const actions = useMemo<SpotlightActionData[]>(() => {
    return (results.data?.items ?? []).map((hit) => {
      const path =
        hit.message_id !== null
          ? `/chats/${encodeURIComponent(hit.session_id)}?m=${hit.message_id}`
          : `/chats/${encodeURIComponent(hit.session_id)}`;
      return {
        id: `${hit.session_id}-${hit.message_id ?? 'title'}`,
        onClick: () => navigate(path),
        children: (
          <Group wrap="nowrap" gap="sm" style={{ width: '100%', minWidth: 0 }} py={2}>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={500} truncate="end" style={{ minWidth: 0 }}>
                  {hit.session_title || hit.session_id}
                </Text>
                {hit.source && <SourceBadge source={hit.source} />}
              </Group>
              <Text size="xs" c="dimmed" truncate="end" component="div">
                <Snippet text={hit.snippet} />
              </Text>
            </Box>
            {hit.timestamp !== null && (
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {formatDateTime(hit.timestamp)}
              </Text>
            )}
          </Group>
        ),
      };
    });
  }, [results.data, navigate]);

  return (
    <Spotlight
      query={query}
      onQueryChange={setQuery}
      actions={actions}
      filter={(_query, filteredActions) => filteredActions}
      nothingFound={
        trimmed.length === 0 ? 'Type to search conversations' : results.isFetching ? 'Searching…' : 'No results'
      }
      searchProps={{ leftSection: <IconSearch size={18} stroke={1.5} />, placeholder: 'Search conversations…' }}
      limit={15}
      shortcut={['mod + K']}
    />
  );
}

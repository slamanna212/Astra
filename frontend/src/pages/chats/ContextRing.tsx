import { RingProgress, Text, Tooltip } from '@mantine/core';
import { formatTokens } from '../../lib/format';

const FALLBACK_CONTEXT_LENGTH = 128 * 1024;

export function ContextRing({
  tokens,
  contextLength,
  estimated,
}: {
  tokens: number;
  contextLength: number | null;
  estimated: boolean;
}) {
  const limit = contextLength && contextLength > 0 ? contextLength : FALLBACK_CONTEXT_LENGTH;
  const rawPercent = limit > 0 ? Math.round((Math.max(0, tokens) / limit) * 100) : 0;
  const percent = Math.min(100, rawPercent);
  const color = percent > 75 ? 'red' : percent > 50 ? 'yellow' : 'teal';
  const provenance = estimated ? 'Estimated from the active transcript' : 'Provider-reported prompt usage';
  const fallback = contextLength && contextLength > 0 ? '' : ' (estimated 128K window)';
  const label = `${provenance}: ${formatTokens(tokens)} / ${formatTokens(limit)} tokens, ${rawPercent}% used${fallback}`;

  return (
    <Tooltip label={label} multiline maw={340}>
      <RingProgress
        size={38}
        thickness={4}
        roundCaps
        sections={[{ value: percent, color }]}
        rootColor="var(--astra-surface-sunk)"
        aria-label={label}
        label={
          <Text ta="center" fz={9} ff="monospace" fw={600}>
            {percent}%
          </Text>
        }
      />
    </Tooltip>
  );
}

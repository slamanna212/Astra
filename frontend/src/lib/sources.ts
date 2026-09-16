/**
 * Mantine color per session source, per the Graphite design language (§2, §5 Badge):
 * teal marks scheduled sources, sand marks chat integrations, everything else is neutral.
 */
export const SOURCE_COLORS: Record<string, string> = {
  cli: 'gray',
  cron: 'teal',
  discord: 'sand',
  subagent: 'gray',
  tui: 'gray',
  webui: 'gray',
};

export const KNOWN_SOURCES = Object.keys(SOURCE_COLORS);

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? 'gray';
}

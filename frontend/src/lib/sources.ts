/** Mantine color per session source — each type gets its own hue so they read apart at a glance. */
export const SOURCE_COLORS: Record<string, string> = {
  cli: 'blue',
  cron: 'teal',
  discord: 'discord',
  subagent: 'grape',
  tui: 'orange',
  webui: 'green',
};

export const KNOWN_SOURCES = Object.keys(SOURCE_COLORS);

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? 'gray';
}

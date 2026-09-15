/** Mantine color per session source. Unknown sources fall back to gray. */
export const SOURCE_COLORS: Record<string, string> = {
  cli: 'blue',
  cron: 'orange',
  discord: 'indigo',
  subagent: 'grape',
  tui: 'teal',
  webui: 'green',
};

export const KNOWN_SOURCES = Object.keys(SOURCE_COLORS);

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? 'gray';
}

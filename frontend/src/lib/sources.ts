/** Mantine color per session source — each type gets its own hue so they read apart at a glance. */
export const SOURCE_COLORS: Record<string, string> = {
  webui: 'green',
  cli: 'blue',
  tui: 'orange',
  discord: 'discord',
  subagent: 'grape',
  cron: 'teal',
  // Hermes labels finite `hermes chat -q` / `hermes -z` runs "oneshot" (agent/session_source.py).
  oneshot: 'gray',
};

/** Display order for the type filter; also the canonical order of a stored selection. */
export const KNOWN_SOURCES = Object.keys(SOURCE_COLORS);

/** Machine-started sessions, hidden from the default "Chats" view. */
export const AUTOMATED_SOURCES = ['cron', 'oneshot'];
export const CHAT_SOURCES = KNOWN_SOURCES.filter((s) => !AUTOMATED_SOURCES.includes(s));

export type SourcePreset = 'chats' | 'automated' | 'all';

export const SOURCE_PRESETS: readonly { value: SourcePreset; label: string; sources: readonly string[] }[] = [
  { value: 'chats', label: 'Chats', sources: CHAT_SOURCES },
  { value: 'automated', label: 'Automated', sources: AUTOMATED_SOURCES },
  { value: 'all', label: 'All', sources: KNOWN_SOURCES },
];

export const DEFAULT_SOURCES: readonly string[] = CHAT_SOURCES;

/** Keep only known ids, in KNOWN_SOURCES order, so equal selections produce equal query keys. */
export function normalizeSources(sources: readonly string[]): string[] {
  return KNOWN_SOURCES.filter((s) => sources.includes(s));
}

/** The preset whose set equals the selection (order-insensitive), or null for a custom mix. */
export function presetFor(sources: readonly string[]): SourcePreset | null {
  const match = SOURCE_PRESETS.find(
    (p) => p.sources.length === sources.length && p.sources.every((s) => sources.includes(s)),
  );
  return match?.value ?? null;
}

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? 'gray';
}

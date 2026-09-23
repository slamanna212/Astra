/** Argument keys that best describe what a tool call is doing, in priority order. */
const PRIMARY_ARG_KEYS = [
  'command', 'cmd', 'path', 'file_path', 'filename', 'url', 'query', 'pattern', 'q',
  'task', 'goal', 'prompt', 'name', 'skill', 'action', 'text',
];

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/** One-line, human-readable summary of a tool call's arguments (e.g. the shell command it ran). */
export function toolArgumentPreview(args: unknown): string {
  const value = parseMaybeJson(args);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value !== 'object' || Array.isArray(value)) return formatToolArguments(value).replace(/\s+/g, ' ');
  const record = value as Record<string, unknown>;
  for (const key of PRIMARY_ARG_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.replace(/\s+/g, ' ').trim();
  }
  const firstString = Object.values(record).find((item) => typeof item === 'string' && item.trim());
  if (typeof firstString === 'string') return firstString.replace(/\s+/g, ' ').trim();
  return formatToolArguments(value).replace(/\s+/g, ' ');
}

/** Pretty-printed arguments for the expanded card body. */
export function formatToolArguments(args: unknown): string {
  const value = parseMaybeJson(args);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** `snake_case` / `mcp__server__tool` → readable label; keeps the raw name available elsewhere. */
export function toolDisplayName(name: string | null | undefined): string {
  if (!name) return 'Tool';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1]} · ${mcp[2]}`;
  return name;
}

export function formatToolDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

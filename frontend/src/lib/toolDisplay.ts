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
  // A list of targets (e.g. web_extract's `urls`): the first one, and how many more.
  const list = Object.values(record).find((item): item is string[] => (
    Array.isArray(item) && item.length > 0 && item.every((entry) => typeof entry === 'string' && entry.trim())
  ));
  if (list) return `${list[0]!.replace(/\s+/g, ' ').trim()}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
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

export type ToolCategory = 'command' | 'read' | 'edit' | 'search' | 'web' | 'delegate' | 'browser' | 'memory' | 'other';

interface ToolVerb {
  done: string;
  running: string;
  category: ToolCategory;
}

const TOOL_VERBS: Record<string, ToolVerb> = {
  terminal: { done: 'Ran command', running: 'Running command', category: 'command' },
  execute_code: { done: 'Ran code', running: 'Running code', category: 'command' },
  process: { done: 'Checked process', running: 'Checking process', category: 'command' },
  read_file: { done: 'Read', running: 'Reading', category: 'read' },
  write_file: { done: 'Wrote', running: 'Writing', category: 'edit' },
  patch: { done: 'Edited', running: 'Editing', category: 'edit' },
  search_files: { done: 'Searched', running: 'Searching', category: 'search' },
  session_search: { done: 'Searched past chats', running: 'Searching past chats', category: 'search' },
  web_search: { done: 'Searched the web', running: 'Searching the web', category: 'web' },
  web_extract: { done: 'Read web page', running: 'Reading web page', category: 'web' },
  delegate_task: { done: 'Delegated', running: 'Delegating', category: 'delegate' },
  memory: { done: 'Updated memory', running: 'Updating memory', category: 'memory' },
  todo: { done: 'Updated todos', running: 'Updating todos', category: 'other' },
  skill_view: { done: 'Viewed skill', running: 'Viewing skill', category: 'read' },
  skills_list: { done: 'Listed skills', running: 'Listing skills', category: 'read' },
  skill_manage: { done: 'Updated skill', running: 'Updating skill', category: 'edit' },
  clarify: { done: 'Asked a question', running: 'Asking a question', category: 'other' },
  vision_analyze: { done: 'Looked at image', running: 'Looking at image', category: 'read' },
  image_generate: { done: 'Generated image', running: 'Generating image', category: 'other' },
  cronjob: { done: 'Updated schedule', running: 'Updating schedule', category: 'other' },
  send_message: { done: 'Sent message', running: 'Sending message', category: 'other' },
};

function toolVerb(name: string | null | undefined): ToolVerb {
  const known = name ? TOOL_VERBS[name] : undefined;
  if (known) return known;
  if (name?.startsWith('browser_')) {
    const action = name.slice('browser_'.length).replace(/_/g, ' ');
    return { done: `Browser ${action}`, running: `Browser ${action}`, category: 'browser' };
  }
  const label = toolDisplayName(name);
  return { done: label, running: label, category: 'other' };
}

/** Readable action for a tool row, e.g. "Ran command" / "Running command". */
export function toolTitle(name: string | null | undefined, running = false): string {
  const verb = toolVerb(name);
  return running ? verb.running : verb.done;
}

export function toolCategory(name: string | null | undefined): ToolCategory {
  return toolVerb(name).category;
}

const CATEGORY_PHRASES: Record<ToolCategory, (n: number) => string> = {
  command: (n) => `ran ${n} command${n === 1 ? '' : 's'}`,
  read: (n) => `read ${n} file${n === 1 ? '' : 's'}`,
  edit: (n) => `edited ${n} file${n === 1 ? '' : 's'}`,
  search: (n) => `searched ${n} time${n === 1 ? '' : 's'}`,
  web: (n) => `${n} web lookup${n === 1 ? '' : 's'}`,
  delegate: (n) => `delegated ${n} task${n === 1 ? '' : 's'}`,
  browser: (n) => `${n} browser step${n === 1 ? '' : 's'}`,
  memory: () => 'updated memory',
  other: (n) => `used ${n} other tool${n === 1 ? '' : 's'}`,
};

/** "Ran 2 commands, read 3 files" — a group's collapsed one-line summary. */
export function summarizeToolNames(names: (string | null)[]): string {
  const counts = new Map<ToolCategory, number>();
  for (const name of names) {
    const category = toolCategory(name);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  if (counts.size === 1 && counts.has('other')) {
    return `Used ${names.length} tool${names.length === 1 ? '' : 's'}`;
  }
  const phrases = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => CATEGORY_PHRASES[category](count));
  const shown = phrases.slice(0, 3);
  if (phrases.length > 3) shown.push(`${phrases.length - 3} more`);
  const text = shown.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

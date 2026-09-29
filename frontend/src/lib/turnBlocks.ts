import type { Message, MessageContentPart } from '../api/types';
import type { LiveActivityEvent } from './liveActivity';
import type { LiveTurn } from './liveTurn';

/**
 * One rendering model for an assistant turn, shared by saved history and the live stream, so a
 * turn looks the same while it streams and after saved history takes over. A turn is a sequence
 * of blocks in the order they happened: prose, and runs of activity (thoughts and tool calls)
 * between the prose.
 */

export type ToolStatus = 'running' | 'pending' | 'done' | 'error';

export interface SubagentItem {
  id: string;
  goal: string;
  status: 'running' | 'done' | 'error';
  childSessionId: string | null;
  /** Latest thing the child reported doing (its current tool or thinking line). */
  activity: string | null;
  toolCount: number;
  duration: number | null;
  summary: string | null;
}

export interface ToolItem {
  kind: 'tool';
  key: string;
  name: string | null;
  arguments: unknown;
  argumentsTruncated: boolean;
  /** Hermes's own one-line preview (live only); otherwise derived from the arguments. */
  preview: string;
  status: ToolStatus;
  duration: number | null;
  result: string | null;
  resultTruncated: boolean;
  risk: boolean;
  /** When the saved call was made, for matching delegated child sessions. */
  timestamp: number | null;
  subagents: SubagentItem[];
}

export interface ThoughtItem {
  kind: 'thought';
  key: string;
  text: string;
}

export interface NoticeItem {
  kind: 'notice';
  key: string;
  label: string;
  detail: string | null;
}

export type ActivityItem = ToolItem | ThoughtItem | NoticeItem;

export type TurnBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'parts'; key: string; parts: MessageContentPart[] }
  | { kind: 'activity'; key: string; items: ActivityItem[] }
  /** Reasoning that is streaming right now, shown open until something else happens. */
  | { kind: 'thinking'; key: string; text: string };

export type ActivityBlock = Extract<TurnBlock, { kind: 'activity' }>;

/** A saved call without a result is still executing while its turn runs. */
export function effectiveStatus(item: ToolItem, pendingIsRunning: boolean): ToolStatus {
  return item.status === 'pending' && pendingIsRunning ? 'running' : item.status;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** A failure with something to read (an error message, a refusal) rather than only a non-zero exit
 * code, which is routine output for a failing test run and not worth opening by itself. */
export function resultHasErrorDetail(result: string | null): boolean {
  if (!result) return false;
  const parsed = parseJson(result);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  return record.success === false
    || (typeof record.error === 'string' && record.error.trim() !== '')
    || record.status === 'blocked';
}

/** Hermes tools report failure inside their JSON result rather than out of band. */
export function resultLooksFailed(result: string | null): boolean {
  if (!result) return false;
  const parsed = parseJson(result);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  if (record.success === false) return true;
  if (typeof record.error === 'string' && record.error.trim()) return true;
  if (typeof record.exit_code === 'number' && record.exit_code !== 0) return true;
  return record.status === 'blocked' || record.status === 'error' || record.status === 'failed';
}

function messageText(message: Message): string | null {
  if (message.content === null) return null;
  if (typeof message.content === 'string') return message.content;
  try {
    return JSON.stringify(message.content, null, 2);
  } catch {
    return String(message.content);
  }
}

// ---------------------------------------------------------------------------------------------
// Saved history
// ---------------------------------------------------------------------------------------------

export type TranscriptEntry =
  /** Rows that are not assistant turn blocks: user messages, notices, unknown roles. */
  | { kind: 'message'; key: string; message: Message }
  | {
      kind: 'block';
      key: string;
      block: TurnBlock;
      /** Saved message ids this block renders, for deep-link highlighting. */
      messageIds: number[];
      /** First block of its turn: carries the assistant avatar. */
      first: boolean;
      /** Last block of its turn: carries the turn's actions. */
      last: boolean;
      /** The message the turn's actions (copy, fork, regenerate) act on. */
      actionMessage: Message | null;
      /** Belongs to the newest assistant turn, whose unanswered tool calls may still be running. */
      latestTurn: boolean;
    };

export type BlockEntry = Extract<TranscriptEntry, { kind: 'block' }>;

/**
 * Turn the saved window into transcript rows. Consecutive assistant and tool rows form one turn:
 * one avatar, one set of actions, with prose and activity interleaved in the order Hermes
 * recorded them (an assistant row's reasoning, then its text, then its tool calls).
 */
export function buildTranscriptEntries(messages: Message[], toolResults: Map<string, Message>): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let turnStart = -1;
  let lastAssistant: Message | null = null;
  let lastWithText: Message | null = null;
  let group: BlockEntry | null = null;
  const consumed = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) if (call.id) consumed.add(call.id);
  }

  const endTurn = () => {
    if (turnStart >= 0 && turnStart < entries.length) {
      const first = entries[turnStart];
      const last = entries.at(-1);
      if (first?.kind === 'block') first.first = true;
      if (last?.kind === 'block') {
        last.last = true;
        last.actionMessage = lastWithText ?? lastAssistant;
      }
    }
    turnStart = -1;
    lastAssistant = null;
    lastWithText = null;
    group = null;
  };
  const pushBlock = (block: TurnBlock, messageId: number): BlockEntry => {
    if (turnStart < 0) turnStart = entries.length;
    const entry: BlockEntry = {
      kind: 'block',
      key: block.key,
      block,
      messageIds: [messageId],
      first: false,
      last: false,
      actionMessage: null,
      latestTurn: false,
    };
    entries.push(entry);
    return entry;
  };
  const addItem = (item: ActivityItem, messageId: number) => {
    if (!group) group = pushBlock({ kind: 'activity', key: `a-${item.key}`, items: [] }, messageId);
    (group.block as ActivityBlock).items.push(item);
    if (!group.messageIds.includes(messageId)) group.messageIds.push(messageId);
  };

  for (const message of messages) {
    if (message.display_kind) {
      endTurn();
      entries.push({ kind: 'message', key: `m-${message.id}`, message });
      continue;
    }
    if (message.role === 'session_meta') continue;
    if (message.role === 'tool') {
      if (message.tool_call_id && consumed.has(message.tool_call_id)) continue;
      // A result whose call is outside the loaded window: keep it visible inside the turn.
      const result = messageText(message);
      addItem({
        kind: 'tool',
        key: `o-${message.id}`,
        name: message.tool_name,
        arguments: null,
        argumentsTruncated: false,
        preview: 'result',
        status: resultLooksFailed(result) ? 'error' : 'done',
        duration: null,
        result,
        resultTruncated: message.truncated,
        risk: false,
        timestamp: message.timestamp,
        subagents: [],
      }, message.id);
      continue;
    }
    if (message.role !== 'assistant') {
      endTurn();
      entries.push({ kind: 'message', key: `m-${message.id}`, message });
      continue;
    }

    lastAssistant = message;
    if (message.reasoning?.trim()) addItem({ kind: 'thought', key: `r-${message.id}`, text: message.reasoning }, message.id);
    if (message.commentary?.trim()) {
      group = null;
      pushBlock({ kind: 'text', key: `c-${message.id}`, text: message.commentary }, message.id);
    }
    if (typeof message.content === 'string' && message.content.trim()) {
      group = null;
      pushBlock({ kind: 'text', key: `t-${message.id}`, text: message.content }, message.id);
      lastWithText = message;
    } else if (Array.isArray(message.content) && message.content.length > 0) {
      group = null;
      pushBlock({ kind: 'parts', key: `p-${message.id}`, parts: message.content }, message.id);
      lastWithText = message;
    }
    (message.tool_calls ?? []).forEach((call, index) => {
      const resultMessage = call.id ? toolResults.get(call.id) : undefined;
      const result = resultMessage ? messageText(resultMessage) : null;
      addItem({
        kind: 'tool',
        key: `${message.id}-${call.id || index}`,
        name: call.name,
        arguments: call.arguments,
        argumentsTruncated: call.arguments_truncated,
        preview: '',
        status: resultMessage ? (resultLooksFailed(result) ? 'error' : 'done') : 'pending',
        duration: null,
        result,
        resultTruncated: resultMessage?.truncated ?? false,
        risk: false,
        timestamp: message.timestamp,
        subagents: [],
      }, message.id);
    });
  }
  endTurn();

  // Only the newest turn can have calls still in flight.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.kind !== 'block') break;
    entry.latestTurn = true;
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function noticeFor(event: LiveActivityEvent, key: string): NoticeItem {
  const data = event.data ?? {};
  const label = [data.message, data.name, data.tool_name, data.status]
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  let detail: string | null = event.text ?? null;
  if (!detail && !label) {
    try {
      detail = JSON.stringify(data, null, 2);
    } catch {
      detail = String(data);
    }
  }
  return { kind: 'notice', key, label: label ?? (event.kind === 'status' ? 'Status' : 'Activity'), detail };
}

const SUBAGENT_FAILED = new Set(['failed', 'error', 'timeout', 'timed_out', 'cancelled', 'interrupted', 'killed']);

function applySubagentEvent(item: SubagentItem, data: Record<string, unknown>) {
  const event = str(data.event) ?? '';
  item.goal = str(data.goal) ?? item.goal;
  item.childSessionId = str(data.child_session_id) ?? item.childSessionId;
  item.toolCount = num(data.tool_count) ?? item.toolCount;
  if (event === 'subagent.tool') {
    const tool = str(data.tool_name);
    const preview = str(data.preview);
    item.activity = [tool, preview].filter(Boolean).join(' · ') || item.activity;
  } else if (event === 'subagent.thinking') {
    item.activity = str(data.preview) ?? item.activity;
  } else if (event === 'subagent.complete') {
    const status = (str(data.status) ?? 'completed').toLowerCase();
    item.status = SUBAGENT_FAILED.has(status) ? 'error' : 'done';
    item.duration = num(data.duration_seconds) ?? item.duration;
    item.summary = str(data.summary) ?? str(data.preview) ?? item.summary;
    item.activity = null;
  }
}

function isRunningState(turn: LiveTurn): boolean {
  return turn.state === 'running' || turn.state === 'sending' || turn.state === 'reconnecting';
}

/**
 * Rebuild the live turn's blocks from its ordered event log. Text, reasoning and tool events keep
 * the order they streamed in, so prose written before a tool call stays above it.
 */
export function buildLiveBlocks(turn: LiveTurn): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let group: ActivityBlock | null = null;
  const open = new Map<string, ToolItem[]>();
  const lastByName = new Map<string, ToolItem>();
  const subagents = new Map<string, SubagentItem>();
  let streamedText = '';
  let lastMeaningful: LiveActivityEvent | null = null;
  // Commentary blocks are finished messages; answer text never merges into one.
  const commentary = new Set<TurnBlock>();

  const addItem = (item: ActivityItem) => {
    if (!group) {
      group = { kind: 'activity', key: `live-a-${blocks.length}`, items: [] };
      blocks.push(group);
    }
    group.items.push(item);
  };
  const runningDelegate = (): ToolItem | null => {
    for (let b = blocks.length - 1; b >= 0; b -= 1) {
      const block = blocks[b]!;
      if (block.kind !== 'activity') continue;
      for (let i = block.items.length - 1; i >= 0; i -= 1) {
        const item = block.items[i]!;
        if (item.kind === 'tool' && item.name === 'delegate_task' && item.status === 'running') return item;
      }
    }
    return null;
  };

  turn.events.forEach((event, index) => {
    if (event.kind === 'phase') return;
    lastMeaningful = event;
    const data = event.data ?? {};
    if (event.kind === 'assistant') {
      const text = event.text ?? '';
      if (!text) return;
      streamedText += text;
      group = null;
      const previous = blocks.at(-1);
      if (previous?.kind === 'text' && !commentary.has(previous)) blocks[blocks.length - 1] = { ...previous, text: previous.text + text };
      else blocks.push({ kind: 'text', key: `live-t-${blocks.length}`, text });
      return;
    }
    if (event.kind === 'commentary') {
      // Mid-turn narration (Codex commentary) is prose, exactly as saved history renders it.
      const text = event.text ?? '';
      if (!text.trim()) return;
      group = null;
      const block: TurnBlock = { kind: 'text', key: `live-c-${index}`, text };
      commentary.add(block);
      blocks.push(block);
      return;
    }
    if (event.kind === 'reasoning') {
      const text = event.text ?? '';
      if (!text.trim()) return;
      const previous = group?.items.at(-1);
      if (previous?.kind === 'thought' && group === blocks.at(-1)) previous.text += text;
      else addItem({ kind: 'thought', key: `live-r-${index}`, text });
      return;
    }
    if (event.kind === 'subagent') {
      const id = str(data.subagent_id) ?? str(data.goal) ?? `subagent-${index}`;
      let item = subagents.get(id);
      if (!item) {
        item = {
          id,
          goal: str(data.goal) ?? str(data.preview) ?? 'Subagent',
          status: 'running',
          childSessionId: null,
          activity: null,
          toolCount: 0,
          duration: null,
          summary: null,
        };
        subagents.set(id, item);
        const parent = runningDelegate();
        if (parent) parent.subagents.push(item);
        else {
          // No visible delegate_task call (its start was already saved): show the child on its own.
          addItem({
            kind: 'tool', key: `live-s-${index}`, name: 'delegate_task', arguments: { goal: item.goal },
            argumentsTruncated: false, preview: item.goal, status: 'running', duration: null, result: null,
            resultTruncated: false, risk: false, timestamp: null, subagents: [item],
          });
        }
      }
      applySubagentEvent(item, data);
      return;
    }
    if (event.kind === 'tool') {
      const phase = str(data.event);
      const name = str(data.name);
      if (phase === 'tool.started') {
        const item: ToolItem = {
          kind: 'tool',
          key: `live-x-${index}`,
          name,
          arguments: data.arguments,
          argumentsTruncated: false,
          preview: str(data.preview) ?? '',
          status: 'running',
          duration: null,
          result: null,
          resultTruncated: false,
          risk: false,
          timestamp: null,
          subagents: [],
        };
        addItem(item);
        const key = name ?? '';
        open.set(key, [...(open.get(key) ?? []), item]);
        lastByName.set(key, item);
        return;
      }
      if (phase === 'tool.completed') {
        const item = open.get(name ?? '')?.shift();
        if (item) {
          item.result = str(data.result);
          item.status = data.is_error === true || resultLooksFailed(item.result) ? 'error' : 'done';
          item.duration = num(data.duration);
          for (const child of item.subagents) if (child.status === 'running') child.status = item.status === 'error' ? 'error' : 'done';
        }
        // Unmatched: its start was trimmed because saved history already shows the call.
        return;
      }
      if (phase === 'tool.output_risk') {
        const item = lastByName.get(name ?? '');
        if (item) item.risk = true;
        return;
      }
      addItem(noticeFor(event, `live-n-${index}`));
      return;
    }
    addItem(noticeFor(event, `live-n-${index}`));
  });

  // The event log is capped; if its oldest prose fell off, restore it from the full answer.
  if (turn.answer && streamedText !== turn.answer && turn.answer.endsWith(streamedText)) {
    const missing = turn.answer.slice(0, turn.answer.length - streamedText.length);
    const first = blocks[0];
    if (first?.kind === 'text' && !commentary.has(first)) blocks[0] = { ...first, text: missing + first.text };
    else blocks.unshift({ kind: 'text', key: 'live-t-head', text: missing });
  }

  // Reasoning that is still streaming stays open on its own until anything else happens.
  const tail = blocks.at(-1);
  const trailing = lastMeaningful as LiveActivityEvent | null;
  if (isRunningState(turn) && trailing?.kind === 'reasoning' && tail?.kind === 'activity') {
    const thought = tail.items.at(-1);
    if (thought?.kind === 'thought') {
      tail.items.pop();
      if (tail.items.length === 0) blocks.pop();
      blocks.push({ kind: 'thinking', key: `live-k-${blocks.length}`, text: thought.text });
    }
  }
  return blocks;
}

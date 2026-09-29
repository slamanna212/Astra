import { describe, expect, it } from 'vitest';
import type { Message } from '../api/types';
import type { LiveActivityEvent } from './liveActivity';
import type { LiveTurn } from './liveTurn';
import { buildToolResultIndex } from './transcript';
import { buildLiveBlocks, buildTranscriptEntries, resultLooksFailed, type ActivityBlock, type ToolItem, type TurnBlock } from './turnBlocks';

function message(id: number, overrides: Partial<Message>): Message {
  return {
    id,
    role: 'assistant',
    content: null,
    truncated: false,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    timestamp: 1_700_000_000 + id,
    token_count: null,
    finish_reason: null,
    reasoning: null,
    display_kind: null,
    display_metadata: null,
    effect_disposition: null,
    active: true,
    compacted: false,
    ...overrides,
  };
}

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: args, arguments_truncated: false });

function entries(messages: Message[]) {
  return buildTranscriptEntries(messages, buildToolResultIndex(messages));
}

describe('buildTranscriptEntries', () => {
  const agentic = [
    message(1, { role: 'user', content: 'Fix the build' }),
    message(2, { reasoning: 'Look first', content: 'Let me check.', tool_calls: [call('a', 'terminal', { command: 'npm test' })] }),
    message(3, { role: 'tool', tool_call_id: 'a', content: '{"output":"1 failed","exit_code":1}' }),
    message(4, { reasoning: 'Read the file', tool_calls: [call('b', 'read_file', { path: 'src/x.ts' })] }),
    message(5, { role: 'tool', tool_call_id: 'b', content: 'code' }),
    message(6, { content: 'Fixed it.' }),
  ];

  it('keeps prose and activity in the order they happened, as one turn', () => {
    const result = entries(agentic);
    expect(result.map((entry) => entry.kind === 'block' ? entry.block.kind : entry.message.role)).toEqual([
      'user', 'activity', 'text', 'activity', 'text',
    ]);
    const [, thought, intro, work, answer] = result;
    expect(thought?.kind === 'block' && (thought.block as ActivityBlock).items.map((item) => item.kind)).toEqual(['thought']);
    expect(intro?.kind === 'block' && intro.block.kind === 'text' && intro.block.text).toBe('Let me check.');
    // The call made after the intro, the next row's reasoning and its call form one run of work.
    expect(work?.kind === 'block' && (work.block as ActivityBlock).items.map((item) => item.kind)).toEqual(['tool', 'thought', 'tool']);
    expect(answer?.kind === 'block' && answer.block.kind === 'text' && answer.block.text).toBe('Fixed it.');
  });

  it('gives the turn one avatar and one set of actions, acting on its final answer', () => {
    const blocks = entries(agentic).filter((entry) => entry.kind === 'block');
    expect(blocks.map((entry) => [entry.first, entry.last])).toEqual([
      [true, false], [false, false], [false, false], [false, true],
    ]);
    expect(blocks.at(-1)?.actionMessage?.id).toBe(6);
    expect(blocks.every((entry) => entry.latestTurn)).toBe(true);
  });

  it('pairs results with calls and reads failures from the result payload', () => {
    const work = entries(agentic)[3];
    const tools = work?.kind === 'block' ? (work.block as ActivityBlock).items.filter((item): item is ToolItem => item.kind === 'tool') : [];
    expect(tools.map((tool) => [tool.name, tool.status, tool.result])).toEqual([
      ['terminal', 'error', '{"output":"1 failed","exit_code":1}'],
      ['read_file', 'done', 'code'],
    ]);
  });

  it('leaves calls without a result pending and only the newest turn as latest', () => {
    const result = entries([
      message(1, { role: 'user', content: 'a' }),
      message(2, { content: 'first answer' }),
      message(3, { role: 'user', content: 'b' }),
      message(4, { tool_calls: [call('z', 'terminal')] }),
    ]);
    const blocks = result.filter((entry) => entry.kind === 'block');
    expect(blocks.map((entry) => entry.latestTurn)).toEqual([false, true]);
    const pending = blocks[1]!.block as ActivityBlock;
    expect((pending.items[0] as ToolItem).status).toBe('pending');
  });

  it('keeps a result whose call is outside the window inside the turn', () => {
    const result = entries([message(9, { role: 'tool', tool_call_id: 'gone', tool_name: 'terminal', content: 'out' })]);
    expect(result).toHaveLength(1);
    const block = result[0]!;
    expect(block.kind === 'block' && (block.block as ActivityBlock).items[0]?.kind).toBe('tool');
  });

  it('ends a turn at notices', () => {
    const result = entries([
      message(1, { content: 'before' }),
      message(2, { role: 'system', display_kind: 'compaction', content: 'Compacted' }),
      message(3, { content: 'after' }),
    ]);
    expect(result.map((entry) => entry.kind === 'block' ? [entry.first, entry.last] : 'notice')).toEqual([
      [true, true], 'notice', [true, true],
    ]);
  });
});

const started = (name: string, extra: Record<string, unknown> = {}): LiveActivityEvent =>
  ({ kind: 'tool', data: { event: 'tool.started', name, ...extra } });
const completed = (name: string, extra: Record<string, unknown> = {}): LiveActivityEvent =>
  ({ kind: 'tool', data: { event: 'tool.completed', name, ...extra } });

function live(events: LiveActivityEvent[], overrides: Partial<LiveTurn> = {}): LiveTurn {
  const answer = events.filter((event) => event.kind === 'assistant').map((event) => event.text).join('');
  return { userText: null, answer, reasoning: '', events, state: 'running', ...overrides };
}

describe('buildLiveBlocks', () => {
  it('interleaves prose and tools in stream order', () => {
    const blocks = buildLiveBlocks(live([
      { kind: 'assistant', text: 'Checking. ' },
      started('terminal', { preview: 'ls' }),
      completed('terminal', { result: 'a' }),
      { kind: 'assistant', text: 'Done.' },
    ]));
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'activity', 'text']);
  });

  it('merges start and completion into one item per call, FIFO per tool name', () => {
    const [group] = buildLiveBlocks(live([
      started('terminal', { preview: 'ls' }),
      started('terminal', { preview: 'pwd' }),
      started('web_extract'),
      completed('terminal', { duration: 0.5, result: 'files' }),
      completed('web_extract', { is_error: true }),
    ])) as ActivityBlock[];
    const tools = group!.items as ToolItem[];
    expect(tools.map((item) => [item.name, item.preview, item.status])).toEqual([
      ['terminal', 'ls', 'done'],
      ['terminal', 'pwd', 'running'],
      ['web_extract', '', 'error'],
    ]);
    expect(tools[0]!.duration).toBe(0.5);
  });

  it('drops completions whose start was already handed over to saved history', () => {
    expect(buildLiveBlocks(live([completed('terminal')]))).toEqual([]);
  });

  it('keeps streaming reasoning open on its own, and folds it into activity once work follows', () => {
    const thinking = buildLiveBlocks(live([{ kind: 'reasoning', text: 'Hmm' }]));
    expect(thinking.map((block) => block.kind)).toEqual(['thinking']);
    const folded = buildLiveBlocks(live([{ kind: 'reasoning', text: 'Hmm' }, started('terminal')]));
    expect(folded.map((block) => block.kind)).toEqual(['activity']);
    expect((folded[0] as ActivityBlock).items.map((item) => item.kind)).toEqual(['thought', 'tool']);
  });

  it('attaches subagent progress to the running delegate call', () => {
    const [group] = buildLiveBlocks(live([
      started('delegate_task', { preview: 'Audit' }),
      { kind: 'subagent', data: { event: 'subagent.start', subagent_id: 's1', goal: 'Audit logs' } },
      { kind: 'subagent', data: { event: 'subagent.tool', subagent_id: 's1', tool_name: 'terminal', preview: 'grep', tool_count: 1, child_session_id: 'c1' } },
    ])) as ActivityBlock[];
    const delegate = group!.items[0] as ToolItem;
    expect(delegate.subagents).toEqual([expect.objectContaining({
      goal: 'Audit logs', status: 'running', activity: 'terminal · grep', toolCount: 1, childSessionId: 'c1',
    })]);
  });

  it('renders Codex commentary as prose, the same shape saved history gives the turn', () => {
    const liveBlocks = buildLiveBlocks(live([
      { kind: 'reasoning', text: 'Plan' },
      { kind: 'commentary', text: 'Checking CI.' },
      started('terminal'),
      completed('terminal', { result: 'ok' }),
      { kind: 'commentary', text: 'CI is green.' },
      { kind: 'assistant', text: 'Done.' },
    ], { state: 'finishing' }));
    const saved = entries([
      message(1, { reasoning: 'Plan', commentary: 'Checking CI.', tool_calls: [call('t1', 'terminal')] }),
      message(2, { role: 'tool', tool_call_id: 't1', content: 'ok' }),
      message(3, { commentary: 'CI is green.', content: 'Done.' }),
    ]).map((entry) => (entry.kind === 'block' ? entry.block : null));
    const shape = (blocks: (TurnBlock | null)[]) => blocks.map((block) => (block?.kind === 'text' ? block.text : block?.kind));
    expect(shape(liveBlocks)).toEqual(['activity', 'Checking CI.', 'activity', 'CI is green.', 'Done.']);
    expect(shape(saved)).toEqual(shape(liveBlocks));
  });

  it('ignores phase markers and restores prose that fell off the capped event log', () => {
    const blocks = buildLiveBlocks(live(
      [{ kind: 'phase', data: { phase: 'model' } }, { kind: 'assistant', text: 'world' }],
      { answer: 'Hello world' },
    ));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind === 'text' && blocks[0]!.text).toBe('Hello world');
  });
});

describe('resultLooksFailed', () => {
  it.each([
    ['{"success": false}', true],
    ['{"error": "boom"}', true],
    ['{"error": ""}', false],
    ['{"exit_code": 0, "output": "ok"}', false],
    ['{"exit_code": 2}', true],
    ['plain text', false],
  ])('%s → %s', (value, expected) => {
    expect(resultLooksFailed(value)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { deriveLiveStatus, type LiveTurn } from './liveTurn';
import { buildLiveBlocks } from './turnBlocks';

function turn(overrides: Partial<LiveTurn> = {}): LiveTurn {
  return { userText: 'Question', answer: '', reasoning: '', events: [], state: 'running', ...overrides };
}

const status = (value: LiveTurn) => deriveLiveStatus(value, buildLiveBlocks(value)).label;

describe('deriveLiveStatus', () => {
  it.each([
    ['Sending', turn({ state: 'sending' })],
    ['Reconnecting', turn({ state: 'reconnecting' })],
    ['Stopped with an error', turn({ state: 'failed' })],
    ['Finishing', turn({ state: 'finishing' })],
    ['Could not refresh saved history', turn({ state: 'unreconciled' })],
    ['Starting', turn({})],
    ['Preparing agent', turn({ events: [{ kind: 'phase', data: { phase: 'preparing', label: 'Preparing agent' } }] })],
    ['Waiting for the model', turn({ events: [{ kind: 'phase', data: { phase: 'model', label: '' } }] })],
    ['Thinking', turn({ events: [{ kind: 'reasoning', text: 'hmm' }] })],
    ['Writing', turn({ events: [{ kind: 'reasoning', text: 'hmm' }, { kind: 'assistant', text: 'Hi' }] })],
    ['Running command', turn({ events: [{ kind: 'tool', data: { event: 'tool.started', name: 'terminal' } }] })],
    ['Working', turn({ events: [{ kind: 'phase', data: { phase: 'model_done', label: '' } }] })],
  ])('reports %s', (expected, value) => {
    expect(status(value)).toBe(expected);
  });

  it('marks failures as errors so they are not shown with a spinner', () => {
    expect(deriveLiveStatus(turn({ state: 'failed' }), []).tone).toBe('error');
    expect(deriveLiveStatus(turn(), []).tone).toBe('active');
  });
});

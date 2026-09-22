import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { render } from '../../../test/render';
import { deriveLivePhase, type LiveTurn } from '../../../lib/liveTurn';
import { LiveTurnRow } from './LiveTurnRow';

function turn(overrides: Partial<LiveTurn> = {}): LiveTurn {
  return { userText: 'Question', answer: '', reasoning: '', events: [], state: 'running', ...overrides };
}

describe('deriveLivePhase', () => {
  it.each([
    ['Sending', turn({ state: 'sending' })],
    ['Reconnecting', turn({ state: 'reconnecting' })],
    ['Error', turn({ state: 'failed' })],
    ['Finishing', turn({ state: 'finishing' })],
    ['Thinking', turn({ reasoning: 'hmm' })],
    ['Working', turn({ events: [{ kind: 'tool', data: { name: 'search' } }] })],
    ['Writing', turn({ answer: 'partial', reasoning: 'hmm' })],
    ['Working', turn({} )],
  ])('labels a %s turn', (expected, value) => {
    expect(deriveLivePhase(value)).toBe(expected);
  });
});

describe('LiveTurnRow', () => {
  it('announces the coarse phase once instead of every streamed token', () => {
    const view = render(<LiveTurnRow turn={turn({ reasoning: 'thinking hard', answer: 'Streamed answer' })} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Writing');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    view.rerender(<LiveTurnRow turn={turn({ reasoning: 'thinking hard', answer: 'Streamed answer plus more tokens' })} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('offers the workspace before any tool event arrives', () => {
    render(<LiveTurnRow turn={turn({ reasoning: 'planning', state: 'running' })} />, { route: '/chats/s1' });
    const trigger = screen.getByRole('button', { name: /Agent workspace/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Agent workspace' })).toBeInTheDocument();
    expect(screen.getByText(/No agent activity yet/i)).toBeInTheDocument();
  });

  it('does not expose reasoning text until the reader expands it', () => {
    render(<LiveTurnRow turn={turn({ reasoning: 'secret plan' })} />, { route: '/chats/s1' });
    expect(screen.queryByText(/secret plan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
    expect(screen.getByText(/secret plan/)).toBeInTheDocument();
  });
});

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    ['Refresh failed', turn({ state: 'unreconciled' })],
    ['Thinking', turn({ reasoning: 'hmm' })],
    ['Working', turn({ events: [{ kind: 'tool', data: { name: 'search' } }] })],
    ['Writing', turn({ answer: 'partial', reasoning: 'hmm' })],
    ['Working', turn({})],
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

  it('does not expose reasoning text until the reader expands it', () => {
    render(<LiveTurnRow turn={turn({ reasoning: 'secret plan' })} />, { route: '/chats/s1' });
    expect(screen.queryByText(/secret plan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
    expect(screen.getByText(/secret plan/)).toBeInTheDocument();
  });

  it('renders tool and subagent activity inline, collapsed by default', () => {
    render(
      <LiveTurnRow
        turn={turn({ events: [{ kind: 'tool', data: { name: 'search', args: ['sensitive argument'] } }] })}
      />,
      { route: '/chats/s1' },
    );
    expect(screen.getByLabelText('Current turn activity')).toHaveTextContent('search');
    expect(screen.queryByText(/sensitive argument/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('search'));
    expect(screen.getByText(/sensitive argument/)).toBeInTheDocument();
  });

  it('shows no activity section when the turn has none', () => {
    render(<LiveTurnRow turn={turn()} />, { route: '/chats/s1' });
    expect(screen.queryByLabelText('Current turn activity')).not.toBeInTheDocument();
  });

  it('keeps the response visible and offers a retry when saved history could not be refreshed', () => {
    const onRetry = vi.fn();
    render(<LiveTurnRow turn={turn({ answer: 'Streamed answer', state: 'unreconciled' })} onRetry={onRetry} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Refresh failed');
    // The text the reader already received must not be thrown away.
    expect(screen.getByText('Streamed answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no retry while the turn is progressing normally', () => {
    render(<LiveTurnRow turn={turn({ answer: 'Streamed answer', state: 'running' })} onRetry={() => {}} />, { route: '/chats/s1' });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

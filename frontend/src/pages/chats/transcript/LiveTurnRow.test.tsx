import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../../test/render';
import { deriveLivePhase, type LiveTurn } from '../../../lib/liveTurn';
import { LiveTurnRow } from './LiveTurnRow';

function turn(overrides: Partial<LiveTurn> = {}): LiveTurn {
  return { userText: 'Question', answer: '', reasoning: '', events: [], state: 'running', ...overrides };
}

function rowProps(overrides: Partial<Parameters<typeof LiveTurnRow>[0]> = {}) {
  return { workspaceOpen: false, onOpenWorkspace: () => {}, ...overrides };
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
    const view = render(<LiveTurnRow turn={turn({ reasoning: 'thinking hard', answer: 'Streamed answer' })} {...rowProps()} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Writing');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    view.rerender(<LiveTurnRow turn={turn({ reasoning: 'thinking hard', answer: 'Streamed answer plus more tokens' })} {...rowProps()} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('asks the transcript to open the workspace instead of owning the drawer', () => {
    // The drawer lives in the transcript so it survives this row being replaced by canonical
    // history mid-turn. The row only requests it.
    const onOpenWorkspace = vi.fn();
    render(<LiveTurnRow turn={turn({ reasoning: 'planning' })} {...rowProps({ onOpenWorkspace })} />, { route: '/chats/s1' });
    fireEvent.click(screen.getByRole('button', { name: /Agent workspace/i }));
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
  });

  it('reports the workspace as expanded so the trigger is not a dead control', () => {
    const view = render(<LiveTurnRow turn={turn()} {...rowProps({ workspaceOpen: true })} />, { route: '/chats/s1' });
    expect(screen.getByRole('button', { name: /Agent workspace/i })).toHaveAttribute('aria-expanded', 'true');
    view.rerender(<LiveTurnRow turn={turn()} {...rowProps({ workspaceOpen: false })} />);
    expect(screen.getByRole('button', { name: /Agent workspace/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not expose reasoning text until the reader expands it', () => {
    render(<LiveTurnRow turn={turn({ reasoning: 'secret plan' })} {...rowProps()} />, { route: '/chats/s1' });
    expect(screen.queryByText(/secret plan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
    expect(screen.getByText(/secret plan/)).toBeInTheDocument();
  });

  it('keeps the response visible and offers a retry when saved history could not be refreshed', () => {
    const onRetry = vi.fn();
    render(<LiveTurnRow turn={turn({ answer: 'Streamed answer', state: 'unreconciled' })} {...rowProps({ onRetry })} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Refresh failed');
    // The text the reader already received must not be thrown away.
    expect(screen.getByText('Streamed answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no retry while the turn is progressing normally', () => {
    render(<LiveTurnRow turn={turn({ answer: 'Streamed answer', state: 'running' })} {...rowProps({ onRetry: () => {} })} />, { route: '/chats/s1' });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

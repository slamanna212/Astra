import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../../test/render';
import type { LiveTurn } from '../../../lib/liveTurn';
import type { BlockContext } from './AssistantBlockRow';
import { LiveTurnRow } from './LiveTurnRow';

const context: BlockContext = { sessionId: 's1', childSessions: [], activityDisplayMode: 'compact_worklog' };

function turn(overrides: Partial<LiveTurn> = {}): LiveTurn {
  return { userText: 'Question', answer: '', reasoning: '', events: [], state: 'running', ...overrides };
}

describe('LiveTurnRow', () => {
  it('announces the current step once instead of every streamed token', () => {
    const events = [{ kind: 'assistant' as const, text: 'Streamed answer' }];
    const view = render(<LiveTurnRow context={context} turn={turn({ answer: 'Streamed answer', events })} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Writing');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    view.rerender(<LiveTurnRow context={context} turn={turn({ answer: 'Streamed answer plus more', events: [{ kind: 'assistant', text: 'Streamed answer plus more' }] })} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('says what the turn is waiting on before any text arrives', () => {
    render(<LiveTurnRow context={context} turn={turn({ events: [{ kind: 'phase', data: { phase: 'model' } }] })} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the model');
    expect(screen.queryByText(/Waiting for response/)).not.toBeInTheDocument();
  });

  it('shows streaming reasoning as a live preview that expands to the full text', () => {
    render(<LiveTurnRow context={context} turn={turn({ reasoning: 'secret plan', events: [{ kind: 'reasoning', text: 'secret plan' }] })} />, { route: '/chats/s1' });
    expect(screen.getByRole('status')).toHaveTextContent('Thinking');
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
    expect(screen.getAllByText(/secret plan/).length).toBeGreaterThan(0);
  });

  it('renders prose and tools in the order they streamed', () => {
    render(
      <LiveTurnRow
        context={context}
        turn={turn({
          answer: 'Before. After.',
          events: [
            { kind: 'assistant', text: 'Before. ' },
            { kind: 'tool', data: { event: 'tool.started', name: 'terminal', arguments: { command: 'ls -la' } } },
            { kind: 'assistant', text: 'After.' },
          ],
        })}
      />,
      { route: '/chats/s1' },
    );
    const text = screen.getByLabelText('Current turn activity').textContent ?? '';
    expect(text.indexOf('Before.')).toBeLessThan(text.indexOf('Running command'));
    expect(text.indexOf('Running command')).toBeLessThan(text.indexOf('After.'));
  });

  it('keeps tool details collapsed until the reader opens them', () => {
    render(
      <LiveTurnRow
        context={context}
        turn={turn({ events: [{ kind: 'tool', data: { event: 'tool.started', name: 'search', arguments: { secret: 'sensitive argument' } } }] })}
      />,
      { route: '/chats/s1' },
    );
    expect(screen.queryByText('Arguments')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /search/ }));
    expect(screen.getByText('Arguments')).toBeInTheDocument();
  });

  it('renders pending prompts inside the turn', () => {
    render(<LiveTurnRow context={context} turn={turn()} prompts={<div>Which environment?</div>} />, { route: '/chats/s1' });
    expect(screen.getByLabelText('Current turn activity')).toHaveTextContent('Which environment?');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your answer');
  });

  it('keeps the response visible and offers a retry when saved history could not be refreshed', () => {
    const onRetry = vi.fn();
    render(
      <LiveTurnRow context={context} turn={turn({ answer: 'Streamed answer', events: [{ kind: 'assistant', text: 'Streamed answer' }], state: 'unreconciled' })} onRetry={onRetry} />,
      { route: '/chats/s1' },
    );
    expect(screen.getByRole('status')).toHaveTextContent('Could not refresh saved history');
    expect(screen.getByText('Streamed answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no retry while the turn is progressing normally', () => {
    render(<LiveTurnRow context={context} turn={turn({ answer: 'Streamed answer', state: 'running' })} onRetry={() => {}} />, { route: '/chats/s1' });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

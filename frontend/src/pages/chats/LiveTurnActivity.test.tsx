import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { appendLiveActivity } from '../../lib/liveActivity';
import { render } from '../../test/render';
import { LiveTurnActivity } from './LiveTurnActivity';

const events = [
  { kind: 'reasoning' as const, text: 'First thought' },
  { kind: 'tool' as const, data: { name: 'terminal', args: ['git status'] } },
  { kind: 'reasoning' as const, text: 'Second thought' },
  { kind: 'assistant' as const, text: 'Finished' },
];

describe('LiveTurnActivity', () => {
  it('does not reserialize completed tool details when more text arrives', () => {
    const toJSON = vi.fn(() => ({ name: 'terminal', command: 'git status' }));
    const current = [{ kind: 'tool' as const, data: { name: 'terminal', toJSON } }];
    const view = render(<LiveTurnActivity events={current} mode="transparent_stream" />);
    expect(toJSON).toHaveBeenCalledTimes(1);
    view.rerender(<LiveTurnActivity events={appendLiveActivity(current, [{ kind: 'assistant', text: 'Done' }])} mode="transparent_stream" />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it('renders concrete events in chronological order in transparent mode', async () => {
    const user = userEvent.setup();
    render(<LiveTurnActivity events={events} mode="transparent_stream" />);

    const stream = screen.getByLabelText('Transparent activity stream');
    expect(stream.textContent).toMatch(/First thought[\s\S]*terminal[\s\S]*Second thought[\s\S]*Finished/);
    await user.click(screen.getByText('terminal'));
    expect(screen.getByText(/git status/)).toBeInTheDocument();
  });

  it('groups operations behind an expandable compact worklog', async () => {
    const user = userEvent.setup();
    render(<LiveTurnActivity events={events} mode="compact_worklog" />);

    expect(screen.getByText('1 tool event')).toBeInTheDocument();
    await user.click(screen.getByText('Worklog'));
    expect(screen.getByText('terminal')).toBeInTheDocument();
  });
});

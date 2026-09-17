import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { render } from '../../test/render';
import { LiveTurnActivity } from './LiveTurnActivity';

const events = [
  { kind: 'reasoning' as const, text: 'First thought' },
  { kind: 'tool' as const, data: { name: 'terminal', args: ['git status'] } },
  { kind: 'reasoning' as const, text: 'Second thought' },
  { kind: 'assistant' as const, text: 'Finished' },
];

describe('LiveTurnActivity', () => {
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

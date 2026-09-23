import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAX_LIVE_ACTIVITY_EVENTS, type LiveActivityEvent } from '../../../lib/liveActivity';
import { render } from '../../../test/render';
import { AgentWorkspaceDrawer } from './AgentWorkspaceDrawer';

const tool = (name: string): LiveActivityEvent => ({ kind: 'tool', data: { name, args: ['secret argument'] } });

describe('AgentWorkspaceDrawer', () => {
  it('lists activity in arrival order with details behind an explicit expand', () => {
    render(
      <AgentWorkspaceDrawer
        opened
        onClose={() => {}}
        events={[tool('read_file'), { kind: 'status', data: { message: 'Reconnecting to provider' } }]}
      />,
      { route: '/chats/s1' },
    );

    const dialog = screen.getByRole('dialog', { name: 'Agent workspace' });
    expect(dialog).toHaveTextContent('tool: read_file');
    expect(dialog).toHaveTextContent('status: Reconnecting to provider');
    // Event payloads stay collapsed until the reader asks for them.
    expect(screen.queryByText(/secret argument/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Event details')[0]!);
    expect(screen.getByText(/secret argument/)).toBeInTheDocument();
  });

  it('states that earlier activity was discarded only once the buffer is actually full', () => {
    const full = Array.from({ length: MAX_LIVE_ACTIVITY_EVENTS }, (_, index) => tool(`tool_${index}`));
    const view = render(<AgentWorkspaceDrawer opened onClose={() => {}} events={full} />, { route: '/chats/s1' });
    expect(screen.getByText(new RegExp(`most recent ${MAX_LIVE_ACTIVITY_EVENTS} events`, 'i'))).toBeInTheDocument();

    // Below capacity nothing has been dropped, so the caveat must disappear rather than
    // warn about data loss that did not happen.
    view.rerender(<AgentWorkspaceDrawer opened onClose={() => {}} events={full.slice(-10)} />);
    expect(screen.queryByText(new RegExp(`most recent ${MAX_LIVE_ACTIVITY_EVENTS} events`, 'i'))).not.toBeInTheDocument();
  });

  it('shows an empty state before any activity arrives', () => {
    render(<AgentWorkspaceDrawer opened onClose={() => {}} events={[]} />, { route: '/chats/s1' });
    expect(screen.getByText(/No agent activity yet/i)).toBeInTheDocument();
  });

  it('describes itself as live-only activity rather than a durable log', () => {
    render(<AgentWorkspaceDrawer opened onClose={() => {}} events={[tool('terminal')]} />, { route: '/chats/s1' });
    expect(screen.getByRole('dialog', { name: 'Agent workspace' })).toHaveTextContent(/not a durable audit log/i);
  });
});

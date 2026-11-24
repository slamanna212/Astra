import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { render } from '../../../test/render';
import type { Message } from '../../../api/types';
import { DisplayKindNotice } from './DisplayKindNotice';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    session_id: 's1',
    role: 'user',
    content: 'FULL MODEL NOTIFICATION TEXT',
    timestamp: 1,
    display_kind: 'async_delegation_complete',
    display_metadata: null,
    ...overrides,
  } as Message;
}

describe('DisplayKindNotice', () => {
  it('paints the compact completion title instead of the full notification text', () => {
    render(
      <DisplayKindNotice
        message={message({ display_metadata: { display_text: 'Subagent Tasks Completed: fix the guide' } })}
      />,
      { route: '/chats/s1' },
    );
    expect(screen.getByText('Subagent Tasks Completed: fix the guide')).toBeInTheDocument();
    expect(screen.queryByText('FULL MODEL NOTIFICATION TEXT')).not.toBeInTheDocument();
  });

  it('falls back to the row content when no display title is present', () => {
    render(<DisplayKindNotice message={message()} />, { route: '/chats/s1' });
    expect(screen.getByText('FULL MODEL NOTIFICATION TEXT')).toBeInTheDocument();
  });

  it('falls back to the display kind when the row has no text at all', () => {
    render(<DisplayKindNotice message={message({ content: '', display_kind: 'compaction' })} />, {
      route: '/chats/s1',
    });
    expect(screen.getByText('compaction')).toBeInTheDocument();
  });
});

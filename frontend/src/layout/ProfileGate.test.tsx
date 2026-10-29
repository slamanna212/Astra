import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, render } from '../test/render';
import type { ProfileSummary } from '../api/bots';

const base: ProfileSummary = {
  name: 'writer',
  title: 'Copy Editor',
  description: '',
  role: null,
  avatar_url: null,
  has_avatar: false,
  model: null,
  provider: null,
  is_default: false,
  hidden: false,
  section: null,
  bot_session_id: null,
  running: false,
  updated_at: null,
  preview: null,
  message_count: 0,
  unread: false,
};

describe('ProfileGate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders the app for an existing profile', async () => {
    window.history.replaceState(null, '', '/p/writer/bots');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ profiles: [base] })));
    const { ProfileGate } = await import('./ProfileGate');
    render(
      <ProfileGate>
        <p>bot chat</p>
      </ProfileGate>,
    );
    expect(await screen.findByText('bot chat')).toBeInTheDocument();
  });

  it('explains a missing bot instead of half-loading the app', async () => {
    window.history.replaceState(null, '', '/p/deleted/bots');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ profiles: [base] })));
    const { ProfileGate } = await import('./ProfileGate');
    render(
      <ProfileGate>
        <p>bot chat</p>
      </ProfileGate>,
    );
    expect(await screen.findByText(/that bot is not here/i)).toBeInTheDocument();
    expect(screen.queryByText('bot chat')).not.toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see all bots/i })).toHaveAttribute('href', '/bots');
  });

  it('does not block the default profile on a roster hiccup', async () => {
    window.history.replaceState(null, '', '/chats');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'nope' }, 500)));
    const { ProfileGate } = await import('./ProfileGate');
    render(
      <ProfileGate>
        <p>default app</p>
      </ProfileGate>,
    );
    expect(await screen.findByText('default app')).toBeInTheDocument();
  });
});

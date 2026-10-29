import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, render } from '../test/render';

const switchProfile = vi.fn((name: string) => `/p/${name}/bots/chat`);

vi.mock('../lib/profileScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/profileScope')>();
  return { ...actual, currentProfile: 'default', switchProfile: (...args: [string]) => switchProfile(...args) };
});

const base = {
  name: 'default',
  title: 'Home',
  description: '',
  role: null,
  avatar_url: null,
  has_avatar: false,
  model: 'deepseek-flash',
  provider: 'deepseek',
  is_default: true,
  hidden: false,
  section: null,
  bot_session_id: 's1',
  running: false,
  updated_at: 1,
  preview: null,
  message_count: 0,
  unread: false,
};

const writer = {
  ...base,
  name: 'writer',
  title: 'Copy Editor',
  description: 'Tightens prose.',
  model: 'claude-sonnet-4',
  is_default: false,
  unread: true,
};

describe('BotPicker', () => {
  beforeEach(() => {
    switchProfile.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ profiles: [base, writer] })));
  });

  it('shows which bot is answering in the composer', async () => {
    const { BotPicker } = await import('./BotPicker');
    render(<BotPicker />);
    const trigger = await screen.findByRole('button', { name: /switch bot/i });
    expect(await within(trigger).findByText('Home')).toBeInTheDocument();
  });

  it('switches to another bot’s own document, not a client-side re-scope', async () => {
    const { BotPicker } = await import('./BotPicker');
    const user = userEvent.setup();
    render(<BotPicker />);

    await user.click(await screen.findByRole('button', { name: /switch bot/i }));
    const menu = await screen.findByRole('menu');
    await user.click(await within(menu).findByText('Copy Editor'));

    expect(switchProfile).toHaveBeenCalledWith('writer', '/bots/chat', '');
  });

  it('does nothing when the current bot is picked again', async () => {
    const { BotPicker } = await import('./BotPicker');
    const user = userEvent.setup();
    render(<BotPicker />);

    await user.click(await screen.findByRole('button', { name: /switch bot/i }));
    const menu = await screen.findByRole('menu');
    await user.click(await within(menu).findByText('Home'));
    expect(switchProfile).not.toHaveBeenCalled();
  });

  it('offers the full roster and creating a bot', async () => {
    const { BotPicker } = await import('./BotPicker');
    const user = userEvent.setup();
    render(<BotPicker />);

    await user.click(await screen.findByRole('button', { name: /switch bot/i }));
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByText('All bots')).toBeInTheDocument();
    expect(within(menu).getByText('New bot').closest('a')).toHaveAttribute('href', '/bots?new=1');
    // Unread state is visible where the choice is made.
    expect(within(menu).getByLabelText('New messages')).toBeInTheDocument();
  });
});

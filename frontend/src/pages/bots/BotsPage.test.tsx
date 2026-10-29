import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, render } from '../../test/render';
import type { ProfileSummary } from '../../api/profiles';

const base: ProfileSummary = {
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

const writer: ProfileSummary = {
  ...base,
  name: 'writer',
  title: 'Copy Editor',
  description: 'Tightens prose and kills adverbs.',
  model: 'anthropic/claude-sonnet-4',
  is_default: false,
  avatar_url: '/api/bots/writer/avatar',
  has_avatar: true,
  unread: true,
  updated_at: 9,
};

const researcher: ProfileSummary = {
  ...base,
  name: 'researcher',
  title: 'Researcher',
  description: 'Reads papers, cites sources.',
  section: 'Work',
  running: true,
  is_default: false,
};

function mockRoster(profiles: ProfileSummary[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ profiles }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BotsPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  it('shows one card per bot with its picture, model and unread marker', async () => {
    mockRoster([base, writer, researcher]);
    const BotsPage = (await import('./BotsPage')).default;
    render(<BotsPage />);

    expect(await screen.findByText('Copy Editor')).toBeInTheDocument();
    expect(screen.getByText('Tightens prose and kills adverbs.')).toBeInTheDocument();
    // A bot with a picture renders an <img>; one without falls back to initials.
    expect(document.querySelector('[data-bot="writer"] img')).toBeInTheDocument();
    expect(screen.getByText('RE')).toBeInTheDocument();
    // Short model chip, not the full provider path.
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
    expect(screen.getAllByLabelText('New messages')).toHaveLength(1);
    expect(screen.getAllByLabelText('Working')).toHaveLength(1);
    // The card for this document is marked active.
    expect(document.querySelector('[data-bot="default"]')).toHaveAttribute('data-active');
  });

  it('opens another bot by loading its own document, never by client routing', async () => {
    mockRoster([base, writer]);
    const BotsPage = (await import('./BotsPage')).default;
    render(<BotsPage />);

    const otherLink = await screen.findByLabelText('Open Copy Editor');
    expect(otherLink.tagName).toBe('A');
    expect(otherLink).toHaveAttribute('href', '/p/writer/bots/chat');

    // The bot this document belongs to stays inside it.
    const ownLink = screen.getByLabelText('Open Home');
    expect(ownLink).toHaveAttribute('href', '/bots/chat');
  });

  it('hides bots that are marked hidden unless they are the current one', async () => {
    mockRoster([base, { ...writer, hidden: true }]);
    const BotsPage = (await import('./BotsPage')).default;
    render(<BotsPage />);

    await screen.findByText('Home');
    expect(screen.queryByText('Copy Editor')).not.toBeInTheDocument();
  });

  it('creates a bot from the roster', async () => {
    const fetchMock = mockRoster([base]);
    const BotsPage = (await import('./BotsPage')).default;
    render(<BotsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /new bot/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^name/i), 'researcher');
    await user.type(within(dialog).getByLabelText(/display name/i), 'Researcher');
    await user.type(within(dialog).getByLabelText(/what this bot does/i), 'Finds papers');
    await user.type(within(dialog).getByLabelText(/instructions/i), 'You cite everything.');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...researcher, name: 'researcher' }, 201));
    await user.click(within(dialog).getByRole('button', { name: /create bot/i }));

    await waitFor(() => {
      const [, init] =
        fetchMock.mock.calls.find(
          ([url, options]) => url === '/api/bots' && options?.method === 'POST',
        ) ?? [];
      expect(init).toBeDefined();
      expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
        name: 'researcher',
        title: 'Researcher',
        description: 'Finds papers',
        soul: 'You cite everything.',
      });
    });
  });

  it('refuses names that would be invalid on disk', async () => {
    mockRoster([base]);
    const BotsPage = (await import('./BotsPage')).default;
    render(<BotsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /new bot/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^name/i), 'Not A Name');
    expect(
      await within(dialog).findByText(/lowercase letters, numbers, dashes and underscores/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /create bot/i })).toBeDisabled();
  });
});

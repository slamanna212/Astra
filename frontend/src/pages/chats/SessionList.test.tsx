import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../../api/types';
import { jsonResponse, render } from '../../test/render';
import { SESSION_ROW_HEIGHT, SessionList } from './SessionList';

function makeSession(i: number): SessionSummary {
  const now = Date.now() / 1000;
  return {
    id: `s-${i}`,
    title: i % 3 === 0 ? null : `Session ${i}`,
    display_name: i % 6 === 0 ? null : `Display ${i}`,
    source: ['cli', 'cron', 'discord', 'subagent', 'tui', 'webui'][i % 6]!,
    model: 'test-model',
    started_at: now - i * 3600,
    last_activity_at: now - i * 60,
    ended_at: null,
    message_count: i,
    tool_call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: null,
    pinned: i === 0,
    archived: false,
    hidden: false,
    parent_session_id: null,
    last_activity_description: null,
  };
}

const VIEWPORT_HEIGHT = 640;

describe('SessionList', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no layout; give the scroll container a real viewport so the virtualizer has a window.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(360);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders only a window of a 500-row list', async () => {
    const items = Array.from({ length: 500 }, (_, i) => makeSession(i));
    fetchMock.mockImplementation(async () => jsonResponse({ items, next_cursor: null }));

    render(<SessionList />, { route: '/chats' });

    const rows = await screen.findAllByTestId('session-row');
    const visibleRows = Math.ceil(VIEWPORT_HEIGHT / SESSION_ROW_HEIGHT);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(visibleRows + 2 * 8 + 2);
    expect(rows.length).toBeLessThan(500);

    // Total scroll height still represents the full list.
    const list = screen.getByRole('list', { name: 'Sessions' });
    expect(list).toHaveStyle({ height: `${500 * SESSION_ROW_HEIGHT}px` });

    // Title fallbacks and pin indicator.
    expect(screen.getByText('Display 3')).toBeInTheDocument();
    expect(screen.getAllByText('Untitled').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('href', '/chats/s-1');
  });

  it('fetches the next page when the window nears the end of loaded rows', async () => {
    const page1 = Array.from({ length: 5 }, (_, i) => makeSession(i));
    const page2 = Array.from({ length: 5 }, (_, i) => makeSession(i + 5));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: page1, next_cursor: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ items: page2, next_cursor: null }));

    render(<SessionList />, { route: '/chats' });

    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(10));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('cursor=c1');
  });

  it('shows an empty state', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], next_cursor: null }));
    render(<SessionList />, { route: '/chats' });
    expect(await screen.findByText('No sessions.')).toBeInTheDocument();
  });
});

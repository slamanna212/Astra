import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildSession, SessionSummary } from '../../api/types';
import { jsonResponse, render } from '../../test/render';
import { SESSION_CHILD_ROW_HEIGHT, SESSION_ROW_HEIGHT, SessionList } from './SessionList';

function makeSession(i: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
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
    child_count: 0,
    ...overrides,
  };
}

function makeChildSession(id: string, startedAt: number, messageCount = 3): ChildSession {
  return {
    id,
    title: `Sub-agent ${id}`,
    display_name: null,
    started_at: startedAt,
    source: 'subagent',
    message_count: messageCount,
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
    let listCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/sessions/count')) return jsonResponse({ count: 0 });
      listCalls += 1;
      return listCalls === 1
        ? jsonResponse({ items: page1, next_cursor: 'c1' })
        : jsonResponse({ items: page2, next_cursor: null });
    });

    render(<SessionList />, { route: '/chats' });

    await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(10));
    expect(listCalls).toBe(2);
    const listRequestUrls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes('/sessions/count'));
    expect(listRequestUrls[1]).toContain('cursor=c1');
  });

  it('shows an empty state', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [], next_cursor: null }));
    render(<SessionList />, { route: '/chats' });
    expect(await screen.findByText('No sessions.')).toBeInTheDocument();
  });

  it('nests sub-agent children under their parent, always expanded', async () => {
    const parent = makeSession(0, { child_count: 2 });
    const children = [makeChildSession('child-a', Date.now() / 1000 - 10), makeChildSession('child-b', Date.now() / 1000 - 5)];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/children')) return jsonResponse({ items: children });
      return jsonResponse({ items: [parent], next_cursor: null });
    });

    render(<SessionList />, { route: '/chats' });

    expect(await screen.findAllByTestId('session-row')).toHaveLength(1);

    const childRows = await screen.findAllByTestId('session-child-row');
    expect(childRows).toHaveLength(2);
    expect(childRows[0]).toHaveAttribute('href', '/chats/child-a');
    expect(childRows[0]).toHaveStyle({ height: `${SESSION_CHILD_ROW_HEIGHT}px` });
    expect(screen.getByText('Sub-agent child-a')).toBeInTheDocument();
  });

  it('shows an archived-count toggle that switches the list to archived sessions', async () => {
    const active = [makeSession(0)];
    const archived = [makeSession(1, { archived: true })];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/sessions/count')) return jsonResponse({ count: 3 });
      if (url.includes('status=archived')) return jsonResponse({ items: archived, next_cursor: null });
      return jsonResponse({ items: active, next_cursor: null });
    });

    const user = userEvent.setup();
    render(<SessionList />, { route: '/chats' });

    const toggle = await screen.findByText('Show 3 archived');
    await user.click(toggle);

    await screen.findByText('Back to active');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('status=archived');
  });
});

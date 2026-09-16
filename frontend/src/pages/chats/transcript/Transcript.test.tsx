import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../../api/types';
import { jsonResponse, render } from '../../../test/render';
import { Transcript } from './Transcript';

function makeMessage(i: number): Message {
  return {
    id: i,
    role: i % 5 === 0 ? 'assistant' : 'user',
    content: `message body ${i}`,
    truncated: false,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    timestamp: 1_700_000_000 + i,
    token_count: null,
    finish_reason: null,
    reasoning: null,
    display_kind: null,
    display_metadata: null,
    effect_disposition: null,
    active: true,
    compacted: false,
  };
}

const VIEWPORT_HEIGHT = 640;
const TOTAL_MESSAGES = 300;

describe('Transcript', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(700);
    // jsdom's layout engine always reports 0; a fixed non-zero row height lets the virtualizer
    // compute a realistic (bounded) visible range instead of treating every 0-height row as
    // simultaneously visible.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 80,
      width: 700,
      top: 0,
      left: 0,
      bottom: 80,
      right: 700,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect);

    const allMessages = Array.from({ length: TOTAL_MESSAGES }, (_, i) => makeMessage(i + 1));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/children')) {
        return jsonResponse({ items: [] });
      }
      // Single-page window: has_older/has_newer both false so no extra fetches happen.
      return jsonResponse({
        items: allMessages,
        has_older: false,
        has_newer: false,
        oldest_id: allMessages[0]!.id,
        newest_id: allMessages.at(-1)!.id,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders a bounded number of rows for a large window', async () => {
    render(<Transcript sessionId="s1" />, { route: '/chats/s1' });

    await waitFor(() => expect(screen.getByTestId('transcript-scroller')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryAllByText(/message body/).length).toBeGreaterThan(0));

    const rendered = screen.getAllByText(/message body/);
    expect(rendered.length).toBeLessThan(TOTAL_MESSAGES);
    // Sanity: comfortably more than a single screenful would need, but nowhere near the full set.
    expect(rendered.length).toBeLessThan(60);
  });

  it('shows an empty state for a conversation with no visible messages', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/children')) return jsonResponse({ items: [] });
      return jsonResponse({ items: [], has_older: false, has_newer: false, oldest_id: null, newest_id: null });
    });
    render(<Transcript sessionId="s1" />, { route: '/chats/s1' });
    expect(await screen.findByText('No messages in this conversation.')).toBeInTheDocument();
  });
});

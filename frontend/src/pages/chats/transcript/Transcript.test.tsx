import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../../api/types';
import { jsonResponse, render } from '../../../test/render';
import { Transcript } from './Transcript';

const markdownRenders = vi.hoisted(() => vi.fn());
vi.mock('react-markdown', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-markdown')>();
  return { ...original, default: (props: Parameters<typeof original.default>[0]) => {
    markdownRenders();
    return <original.default {...props} />;
  } };
});

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

  it('shows the optimistic exchange in the transcript before canonical messages exist', async () => {
    fetchMock.mockImplementation(async (input) => String(input).includes('/children')
      ? jsonResponse({ items: [] })
      : jsonResponse({ items: [], has_older: false, has_newer: false, oldest_id: null, newest_id: null }));
    render(<Transcript sessionId="s1" liveTurn={{ userText: 'New question', answer: 'Partial answer', reasoning: '', events: [], state: 'running' }} />, { route: '/chats/s1' });
    expect(await screen.findByText('New question')).toBeInTheDocument();
    expect(screen.getByText('Partial answer')).toBeInTheDocument();
  });

  it('keeps workspace and reasoning behind collapsed accessible controls', async () => {
    fetchMock.mockImplementation(async (input) => String(input).includes('/children')
      ? jsonResponse({ items: [] })
      : jsonResponse({ items: [], has_older: false, has_newer: false, oldest_id: null, newest_id: null }));
    render(<Transcript sessionId="s1" liveTurn={{ userText: 'Question', answer: 'Only answer', reasoning: 'Private thought', events: [{ kind: 'tool', data: { name: 'search', args: ['sensitive argument'] } }], state: 'running' }} />, { route: '/chats/s1' });
    await screen.findByText('Only answer');
    expect(screen.queryByText('Private thought')).not.toBeInTheDocument();
    expect(screen.queryByText('sensitive argument')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Agent workspace/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Agent workspace/i }));
    expect(screen.getByRole('dialog', { name: /Agent workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/tool: search/)).toBeInTheDocument();
    expect(screen.queryByText(/sensitive argument/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Event details'));
    expect(screen.getByText(/sensitive argument/)).toBeInTheDocument();
  });

  it('keeps the agent workspace open when the live row is replaced by canonical history', async () => {
    // The row is a placeholder that disappears on handoff; the drawer the reader opened must not
    // disappear with it.
    fetchMock.mockImplementation(async (input) => String(input).includes('/children')
      ? jsonResponse({ items: [] })
      : jsonResponse({ items: [], has_older: false, has_newer: false, oldest_id: null, newest_id: null }));
    const view = render(
      <Transcript
        sessionId="s1"
        liveTurn={{ userText: 'Question', answer: '', reasoning: '', events: [{ kind: 'tool', data: { name: 'search_files' } }], state: 'running' }}
      />,
      { route: '/chats/s1' },
    );
    await screen.findByText('Question');
    fireEvent.click(screen.getByRole('button', { name: /Agent workspace/i }));
    expect(screen.getByRole('dialog', { name: /Agent workspace/i })).toBeInTheDocument();

    view.rerender(<Transcript sessionId="s1" liveTurn={null} />);

    expect(screen.getByRole('dialog', { name: /Agent workspace/i })).toHaveTextContent('tool: search_files');
  });

  it('shows a mid-turn reload as the durable user turn followed by the partial answer', async () => {
    // Hermes persists the inbound user turn before the first model call, so after a reload the
    // canonical window already carries it. The live row must sit below it and must not repeat it.
    const earlierReply = { ...makeMessage(1), role: 'assistant' as const, content: 'An earlier reply' };
    const durableUser = { ...makeMessage(2), role: 'user' as const, content: 'Question that was persisted' };
    fetchMock.mockImplementation(async (input) => String(input).includes('/children')
      ? jsonResponse({ items: [] })
      : jsonResponse({ items: [earlierReply, durableUser], has_older: false, has_newer: false, oldest_id: 1, newest_id: 2 }));

    render(
      <Transcript
        sessionId="s1"
        liveTurn={{ userText: null, answer: 'Partial streamed answer', reasoning: '', events: [], state: 'reconnecting' }}
      />,
      { route: '/chats/s1' },
    );

    await screen.findByText('Question that was persisted');
    expect(screen.getAllByText(/Question that was persisted/)).toHaveLength(1);
    const text = screen.getByTestId('transcript-scroller').textContent ?? '';
    expect(text.indexOf('Question that was persisted')).toBeLessThan(text.indexOf('Partial streamed answer'));
  });

  it('does not render the live answer twice once canonical history already contains it', async () => {
    const canonical = { ...makeMessage(1), role: 'assistant' as const, content: 'Duplicate answer' };
    fetchMock.mockImplementation(async (input) => String(input).includes('/children')
      ? jsonResponse({ items: [] })
      : jsonResponse({ items: [canonical], has_older: false, has_newer: false, oldest_id: 1, newest_id: 1 }));
    render(<Transcript sessionId="s1" liveTurn={{ userText: 'Question', answer: 'Duplicate answer', reasoning: '', events: [], state: 'finishing' }} />, { route: '/chats/s1' });
    await waitFor(() => expect(screen.getAllByText(/Duplicate answer/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Duplicate answer/)).toHaveLength(1);
  });

  it('jumps instantly when the reader prefers reduced motion', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    render(<Transcript sessionId="s1" />, { route: '/chats/s1' });
    const scroller = await screen.findByTestId('transcript-scroller');
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 4000 },
      clientHeight: { configurable: true, value: 640 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(scroller);
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('does not jump to the bottom for a new local command while reading older messages', async () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const view = render(<Transcript sessionId="s1" />, { route: '/chats/s1' });
    const scroller = await screen.findByTestId('transcript-scroller');
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 4000 },
      clientHeight: { configurable: true, value: 640 },
      scrollTop: { configurable: true, writable: true, value: 400 },
    });
    fireEvent.scroll(scroller);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    scrollTo.mockClear();
    view.rerender(<Transcript sessionId="s1" skillCommands={[{ id: 1, command: '/skills', query: null, groups: [], matchCount: 0, error: null }]} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  // A virtualized list is anchored from an estimated height and then re-measured into a much taller
  // one. The bottom therefore moves away from a reader who never scrolled, and reporting that as
  // "the reader left the bottom" silently stops the stream from following.
  function defineGeometry(scroller: HTMLElement, initial: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    let top = initial.scrollTop;
    let height = initial.scrollHeight;
    const max = () => Math.max(0, height - initial.clientHeight);
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => initial.clientHeight },
    });
    // Mimic the browser: scrollTop clamps to the scrollable range rather than storing the request.
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.min(Math.max(0, value), max()); },
    });
    return {
      /** Re-measure the list, as the virtualizer does once real row heights are known. */
      setScrollHeight: (value: number) => {
        height = value;
        top = Math.min(top, max());
      },
    };
  }

  it('keeps following the stream when the measured list grows under a reader who has not scrolled', async () => {
    const view = render(
      <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a', reasoning: '', events: [], state: 'running' }} />,
      { route: '/chats/s1' },
    );
    const scroller = await screen.findByTestId('transcript-scroller');
    const geometry = defineGeometry(scroller, { scrollHeight: 1000, clientHeight: 640, scrollTop: 0 });

    // Content grew; the viewport itself never moved, so this is not the reader leaving the bottom.
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // Measurement lands and the streamed answer grows: the reader should stay pinned.
    geometry.setScrollHeight(40000);
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(200), reasoning: '', events: [], state: 'running' }} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(scroller.scrollTop).toBe(40000 - 640);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('does not move a reader who scrolled away from the bottom when the list grows', async () => {
    const view = render(
      <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a', reasoning: '', events: [], state: 'running' }} />,
      { route: '/chats/s1' },
    );
    const scroller = await screen.findByTestId('transcript-scroller');
    const geometry = defineGeometry(scroller, { scrollHeight: 1000, clientHeight: 640, scrollTop: 360 });

    // The reader scrolls up to read, which is intent to stop following.
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();

    geometry.setScrollHeight(40000);
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(200), reasoning: '', events: [], state: 'running' }} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    fireEvent.scroll(scroller);

    expect(scroller.scrollTop).toBe(100);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
  });

  it('resumes following when the reader returns to the bottom', async () => {
    const view = render(
      <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a', reasoning: '', events: [], state: 'running' }} />,
      { route: '/chats/s1' },
    );
    const scroller = await screen.findByTestId('transcript-scroller');
    const geometry = defineGeometry(scroller, { scrollHeight: 1000, clientHeight: 640, scrollTop: 100 });

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // Back to the bottom.
    scroller.scrollTop = 360;
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    geometry.setScrollHeight(40000);
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(200), reasoning: '', events: [], state: 'running' }} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    fireEvent.scroll(scroller);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(scroller.scrollTop).toBe(40000 - 640);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('does not mistake its own anchor for the reader scrolling when the list grew before the event', async () => {
    // The scroll event produced by our own anchoring can arrive after the list has been re-measured
    // again, so the geometry at that moment no longer looks like the bottom. Trusting it would stop
    // the stream following for a reader who never moved.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
    const view = render(
      <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a', reasoning: '', events: [], state: 'running' }} />,
      { route: '/chats/s1' },
    );
    const scroller = await screen.findByTestId('transcript-scroller');
    const geometry = defineGeometry(scroller, { scrollHeight: 1000, clientHeight: 640, scrollTop: 0 });
    fireEvent.scroll(scroller);
    await act(flush);

    // The streamed answer grows, so the reader is anchored to the bottom of the re-measured list.
    geometry.setScrollHeight(40000);
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(200), reasoning: '', events: [], state: 'running' }} />,
      );
      await flush();
    });
    expect(scroller.scrollTop).toBe(40000 - 640);

    // The event for that move lands only now, by which time the list has grown again.
    geometry.setScrollHeight(80000);
    fireEvent.scroll(scroller);
    await act(flush);

    // Still following, so the next growth keeps the reader pinned rather than stranding them.
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(400), reasoning: '', events: [], state: 'running' }} />,
      );
      await flush();
    });
    fireEvent.scroll(scroller);
    await act(flush);

    expect(scroller.scrollTop).toBe(80000 - 640);
  });

  it('resumes following the stream after an explicit jump to latest', async () => {
    // Asking for the latest is a request to follow, and it must not depend on the browser emitting
    // a final scroll event for the jump for the stream to start tracking the tail again.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
    HTMLElement.prototype.scrollTo = vi.fn();
    const view = render(
      <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a', reasoning: '', events: [], state: 'running' }} />,
      { route: '/chats/s1' },
    );
    const scroller = await screen.findByTestId('transcript-scroller');
    const geometry = defineGeometry(scroller, { scrollHeight: 1000, clientHeight: 640, scrollTop: 360 });

    // The reader scrolls away from the bottom, so the stream stops following.
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await act(flush);

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    await act(flush);

    // Growth keeps them pinned again, even though the jump itself reported no scroll.
    geometry.setScrollHeight(40000);
    await act(async () => {
      view.rerender(
        <Transcript sessionId="s1" liveTurn={{ userText: 'Q', answer: 'a'.repeat(200), reasoning: '', events: [], state: 'running' }} />,
      );
      await flush();
    });

    expect(scroller.scrollTop).toBe(40000 - 640);
  });

  it('does not reparse historical Markdown on parent updates or running-state changes', async () => {
    const view = render(<Transcript sessionId="s1" />, { route: '/chats/s1' });
    await waitFor(() => expect(screen.queryAllByText(/message body/).length).toBeGreaterThan(0));
    markdownRenders.mockClear();
    for (let i = 0; i < 10; i++) view.rerender(<Transcript sessionId="s1" />);
    view.rerender(<Transcript sessionId="s1" running />);
    expect(markdownRenders).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /Regenerate response|Retry from this message/ })[0]).toBeDisabled();
  });
});

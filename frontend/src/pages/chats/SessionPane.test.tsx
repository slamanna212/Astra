import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { jsonResponse, render } from '../../test/render';
import type { SessionDetail } from '../../api/types';
import { loadChatRecovery, saveChatRecovery } from '../../lib/chatRecovery';
import SessionPane from './SessionPane';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../../lib/refreshMessages', () => ({ refreshMessages: refresh }));
vi.mock('./transcript/Transcript', () => ({
  Transcript: ({ liveTurn, onRetryLiveTurn }: { liveTurn?: { userText: string | null; answer: string; state: string } | null; onRetryLiveTurn?: () => void }) => (
    <div>
      History
      {liveTurn && <div data-testid="live-turn">{liveTurn.userText} {liveTurn.answer} {liveTurn.state}</div>}
      {/* Mirrors the real contract: the retry affordance only exists for an unreconciled turn. */}
      {onRetryLiveTurn && liveTurn?.state === 'unreconciled' && <button onClick={onRetryLiveTurn}>Retry history refresh</button>}
    </div>
  ),
}));
vi.mock('./ChatComposer', () => ({
  ChatComposer: ({ draft, onDraftChange, onSend, liveTps }: { draft: string; onDraftChange: (text: string) => void; onSend: (text: string) => Promise<void>; liveTps: number | null }) => (
    <><input aria-label="Draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} /><button onClick={() => void onSend(draft).catch(() => {})}>Send</button><output data-testid="tps">{liveTps ?? 'none'}</output></>
  ),
}));

const session: SessionDetail = {
  id: 's1', title: 'Chat', display_name: null, source: 'webui', model: 'test',
  started_at: 1700000000, last_activity_at: null, ended_at: null, message_count: 2,
  tool_call_count: 0, input_tokens: 4, output_tokens: 5, estimated_cost_usd: null,
  pinned: false, archived: false, hidden: false, parent_session_id: null,
  last_activity_description: null, child_count: 0, context_length: null,
  last_prompt_tokens: null, context_tokens: 4, context_tokens_estimated: true,
};

class Stream extends EventTarget {
  static instances: Stream[] = [];
  onopen: ((event: Event) => void) | null = null;
  seq = 0;
  constructor(readonly url: string) { super(); Stream.instances.push(this); }
  close() {}
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: String(++this.seq) }));
  }
  open(running = false) {
    this.onopen?.(new Event('open'));
    this.emit('state', { running });
  }
}

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function flushFrame() {
  for (const [id, callback] of [...frames]) {
    frames.delete(id);
    callback(0);
  }
}

async function mount(running = false) {
  const view = render(<Routes><Route path="/chats/:sessionId" element={<SessionPane />} /></Routes>, { route: '/chats/s1' });
  await screen.findByLabelText('Draft');
  const stream = Stream.instances[0]!;
  act(() => stream.open(running));
  return { ...view, stream };
}

beforeEach(() => {
  localStorage.clear();
  Stream.instances = [];
  frames.clear();
  refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => jsonResponse(
    String(input).endsWith('/options')
      ? { default_model: 'test', default_provider: null, models: [], providers: [] }
      : session,
  )));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('conversation stream updates', () => {
  it('marks the live turn as reconnecting when the stream drops', async () => {
    const { stream } = await mount();
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Partial' }));
    act(flushFrame);
    act(() => stream.dispatchEvent(new Event('error')));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('reconnecting');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
    expect(screen.queryByText('Connection interrupted')).not.toBeInTheDocument();
  });

  it('silently restores a response while reconnecting to an active turn', async () => {
    saveChatRecovery('s1', { lastEventId: 7, streaming: 'Saved partial', reasoning: '', activity: [], events: [] });
    const { stream } = await mount(true);
    expect(stream.url).toContain('7');
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Saved partial');
    expect(screen.queryByText('Response restored')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry connection' })).not.toBeInTheDocument();
    expect(loadChatRecovery('s1')?.streaming).toBe('Saved partial');
  });

  it('keeps a restored response until finished history is refreshed', async () => {
    let finishRefresh!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    saveChatRecovery('s1', { lastEventId: 7, streaming: 'Saved answer', reasoning: '', activity: [], events: [] });
    await mount(false);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Saved answer');
    expect(loadChatRecovery('s1')?.streaming).toBe('Saved answer');
    expect(screen.queryByText('Response restored')).not.toBeInTheDocument();
    await act(async () => finishRefresh());
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
    expect(loadChatRecovery('s1')).toBeNull();
  });

  it('retains saved text when finished history refresh fails, then clears it after retry', async () => {
    refresh.mockRejectedValueOnce(new Error('offline'));
    saveChatRecovery('s1', { lastEventId: 7, streaming: 'Saved answer', reasoning: '', activity: [], events: [] });
    await mount(false);
    await waitFor(() => expect(screen.getByTestId('live-turn')).toHaveTextContent('unreconciled'));
    expect(loadChatRecovery('s1')?.streaming).toBe('Saved answer');
    fireEvent.click(screen.getByRole('button', { name: 'Retry history refresh' }));
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
    expect(loadChatRecovery('s1')).toBeNull();
  });

  it('keeps a cancelled partial response until canonical history replaces it', async () => {
    let finishRefresh!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const { stream } = await mount();
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Cancelled partial' }));
    act(flushFrame);
    act(() => stream.emit('cancel', {}));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Cancelled partial');
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await act(async () => finishRefresh());
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
  });

  it('preserves the draft and removes optimistic rows when sending fails', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => init?.method === 'POST'
      ? Promise.resolve(jsonResponse({ detail: 'Rejected' }, 500))
      : originalFetch(input as RequestInfo)));
    await mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep this');
  });

  it('does not drop SSE answer deltas arriving before the send request resolves', async () => {
    let resolveSend!: (response: Response) => void;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => { resolveSend = resolve; })
      : originalFetch(input as RequestInfo)));
    const { stream } = await mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Race' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Early' }));
    act(flushFrame);
    await act(async () => resolveSend(jsonResponse({ status: 'started' })));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Race Early');
  });

  it('does not wipe deltas that arrive before the started frame while the send is pending', async () => {
    // The optimistic turn is created before the POST resolves, so a delta can land before the
    // server's `started` frame. `started` must not reset buffers that a send is still filling.
    let resolveSend!: (response: Response) => void;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => { resolveSend = resolve; })
      : originalFetch(input as RequestInfo)));
    const { stream } = await mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Race' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => stream.emit('delta', { text: 'Early' }));
    act(flushFrame);
    act(() => stream.emit('started', { operation: 'chat' }));
    act(flushFrame);
    await act(async () => resolveSend(jsonResponse({ status: 'started' })));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Race Early');
  });

  it('does not end the turn on a stale idle state frame while the send is pending', async () => {
    // A resubscribe can deliver a `state` frame computed before this turn started. Acting on it
    // while the POST is still in flight would retire the optimistic row and lose the response.
    let resolveSend!: (response: Response) => void;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => { resolveSend = resolve; })
      : originalFetch(input as RequestInfo)));
    const { stream } = await mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Alive' }));
    act(flushFrame);
    act(() => stream.emit('state', { running: false }));
    act(flushFrame);
    await act(async () => resolveSend(jsonResponse({ status: 'started' })));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Keep Alive');
  });

  it('shows the optimistic exchange before the send request resolves', async () => {
    let resolveSend!: (response: Response) => void;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => { resolveSend = resolve; })
      : originalFetch(input as RequestInfo)));
    await mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Ask now' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Ask now');
    expect(screen.getByLabelText('Draft')).toHaveValue('Ask now');
    await act(async () => resolveSend(jsonResponse({ status: 'started' })));
  });

  it('keeps the streamed response and offers a retry when the history refresh fails', async () => {
    // A failed refresh must not leave the row claiming to be "finishing" forever, and must not
    // discard text the reader already received.
    refresh.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const { stream } = await mount();
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Streamed answer' }));
    act(flushFrame);
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('live-turn')).toHaveTextContent('unreconciled'));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Streamed answer');
    expect(loadChatRecovery('s1')?.streaming).toBe('Streamed answer');

    refresh.mockImplementationOnce(() => Promise.resolve(undefined));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
    expect(loadChatRecovery('s1')).toBeNull();
  });

  it('reports the turn as finishing while the canonical refresh is still in flight', async () => {
    // The response text arriving is not the end of the turn: the reader must be able to tell that
    // history is still being reconciled, rather than seeing a stale "Writing" phase.
    let finishRefresh!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const { stream } = await mount();
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Complete answer' }));
    act(flushFrame);
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByTestId('live-turn')).toHaveTextContent('finishing');
    await act(async () => finishRefresh());
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
  });

  it('keeps the partial response until canonical refresh finishes', async () => {
    let finishRefresh!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const { stream } = await mount();
    act(() => stream.emit('started', { operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Partial' }));
    act(flushFrame);
    act(() => stream.emit('done', {}));
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Partial');
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await act(async () => finishRefresh());
    await waitFor(() => expect(screen.queryByTestId('live-turn')).not.toBeInTheDocument());
  });

  it('shows a live rate while the model is reasoning', async () => {
    const { stream } = await mount();
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('reasoning', { text: 'Thinking', tps: 42 }));
    act(flushFrame);
    expect(screen.getByTestId('tps')).toHaveTextContent('42');
  });

  it('batches text and TPS together and incrementally refreshes an observed chat turn', async () => {
    const { stream, queryClient } = await mount();
    expect(refresh).not.toHaveBeenCalled();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Hello ', tps: 10 }));
    act(() => stream.emit('delta', { text: 'world', tps: 20 }));
    expect(screen.getByTestId('tps')).toHaveTextContent('none');
    expect(frames.size).toBe(1);
    act(flushFrame);
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Hello world');
    expect(screen.getByTestId('tps')).toHaveTextContent('20');
    act(() => stream.emit('delta', { text: '!', tps: 30 }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: false }));
    expect(screen.getByTestId('tps')).toHaveTextContent('none');
    expect(frames.size).toBe(0);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['chat', 'active'], ['chat', 'active'], ['sessions', 'detail', 's1'], ['sessions', 'list'],
    ]);
  });

  it.each(['regenerate', 'compact', undefined])('reconciles history for operation %s', async (operation) => {
    const { stream, queryClient } = await mount();
    act(() => stream.emit('started', { running: true, operation }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: true })));
  });

  it('reconciles automatic compaction during a normal turn', async () => {
    const { stream, queryClient } = await mount();
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('compaction', { phase: 'done' }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: true })));
  });

  it('does not show compaction progress for a context configuration notice', async () => {
    const { stream } = await mount();
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('status', {
      kind: 'status',
      message: 'Hermes is using a 272K context limit for this Codex gpt-5.6-luna session.',
    }));
    act(flushFrame);
    expect(screen.queryByText('Compacting context')).not.toBeInTheDocument();

    act(() => stream.emit('status', { kind: 'compacting', message: 'Summarizing earlier conversation…' }));
    expect(screen.getByText('Compacting context')).toBeInTheDocument();
  });

  it('reconciles a turn already running when the conversation opens', async () => {
    const { stream, queryClient } = await mount(true);
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: true })));
  });

  it('refreshes once after reconnecting instead of refetching on every connection event', async () => {
    const { stream, queryClient } = await mount();
    act(() => stream.dispatchEvent(new Event('error')));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    act(() => Stream.instances[1]!.open(false));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: true }));
  });

  it('does not clear a following turn when an earlier history refresh finishes', async () => {
    let finishRefresh!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    const { stream } = await mount();
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    act(() => stream.emit('started', { running: true, operation: 'chat' }));
    act(() => stream.emit('delta', { text: 'Next response' }));
    act(flushFrame);
    await act(async () => finishRefresh());
    expect(screen.getByTestId('live-turn')).toHaveTextContent('Next response');
  });
});

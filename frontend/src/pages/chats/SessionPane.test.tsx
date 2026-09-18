import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { jsonResponse, render } from '../../test/render';
import type { SessionDetail } from '../../api/types';
import SessionPane from './SessionPane';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../../lib/refreshMessages', () => ({ refreshMessages: refresh }));
vi.mock('./transcript/Transcript', () => ({ Transcript: () => <div>History</div> }));
vi.mock('./ChatComposer', () => ({
  ChatComposer: ({ draft, onDraftChange, liveTps }: { draft: string; onDraftChange: (text: string) => void; liveTps: number | null }) => (
    <><input aria-label="Draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} /><output data-testid="tps">{liveTps ?? 'none'}</output></>
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
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByTestId('tps')).toHaveTextContent('20');
    act(() => stream.emit('delta', { text: '!', tps: 30 }));
    act(() => stream.emit('done', {}));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledWith(queryClient, 's1', expect.objectContaining({ reconcile: false }));
    expect(screen.getByTestId('tps')).toHaveTextContent('none');
    expect(frames.size).toBe(0);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['sessions', 'detail', 's1'], ['sessions', 'list'],
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
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
    expect(screen.getByText('Next response')).toBeInTheDocument();
  });
});

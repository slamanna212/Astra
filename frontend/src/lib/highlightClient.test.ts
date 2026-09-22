import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightClient, type HighlightRequest, type HighlightResponse } from './highlightClient';

class FakeWorker {
  onmessage: ((event: MessageEvent<HighlightResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn<(request: HighlightRequest) => void>();
  terminate = vi.fn();
  reply(html: string) {
    const request = this.postMessage.mock.calls.at(-1)![0];
    this.onmessage?.({ data: { id: request.id, html } } as MessageEvent<HighlightResponse>);
  }
}

const input = { code: 'const n = 1;', language: 'js', start: 0, end: 12 };
afterEach(() => vi.useRealTimers());

describe('highlight worker lifecycle', () => {
  it('shares a worker, serializes work, removes canceled jobs, and releases idle resources', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const create = vi.fn(() => worker as unknown as Worker);
    const client = new HighlightClient(create);
    const first = client.request(input);
    const canceled = client.request(input);
    const third = client.request(input);
    canceled.cancel();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.reply('first');
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.reply('third');
    expect(await Promise.all([first.promise, canceled.promise, third.promise])).toEqual(['first', null, 'third']);
    expect(create).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates canceled active work and ignores late replies from the old worker', async () => {
    vi.useFakeTimers();
    const oldWorker = new FakeWorker();
    const nextWorker = new FakeWorker();
    const create = vi.fn().mockReturnValueOnce(oldWorker).mockReturnValue(nextWorker);
    const client = new HighlightClient(create);
    const old = client.request(input);
    const next = client.request({ ...input, code: 'new' });
    old.cancel();
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    oldWorker.reply('stale');
    nextWorker.reply('new');
    expect(await old.promise).toBeNull();
    expect(await next.promise).toBe('new');
    vi.advanceTimersByTime(30_000);
  });

  it('falls back to plain text when workers fail or are unavailable', async () => {
    const unavailable = new HighlightClient(() => { throw new Error('Worker unavailable'); });
    expect(await unavailable.request(input).promise).toBeNull();
    const worker = new FakeWorker();
    const client = new HighlightClient(() => worker as unknown as Worker);
    const request = client.request(input);
    worker.onerror?.();
    expect(await request.promise).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('recovers from a stalled grammar so queued previews can continue', async () => {
    vi.useFakeTimers();
    const stalledWorker = new FakeWorker();
    const nextWorker = new FakeWorker();
    const client = new HighlightClient(vi.fn().mockReturnValueOnce(stalledWorker).mockReturnValue(nextWorker));
    const stalled = client.request(input);
    const next = client.request(input);
    vi.advanceTimersByTime(5_000);
    expect(await stalled.promise).toBeNull();
    expect(stalledWorker.terminate).toHaveBeenCalledOnce();
    nextWorker.reply('next');
    expect(await next.promise).toBe('next');
    vi.advanceTimersByTime(30_000);
  });
});

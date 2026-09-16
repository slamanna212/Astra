import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAuthenticated, login } from './auth';
import { ApiError, apiFetch, buildUrl, setUnauthorizedHandler } from './client';
import { listSessions } from './sessions';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const onUnauthorized = vi.fn();
  let unregister: () => void;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    unregister = setUnauthorizedHandler(onUnauthorized);
  });

  afterEach(() => {
    unregister();
    fetchMock.mockReset();
    onUnauthorized.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends same-origin credentials and the X-Requested-With header', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await apiFetch('/thing', { method: 'POST', body: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/thing');
    expect(init?.credentials).toBe('same-origin');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBe('astra');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('invokes the unauthorized handler and throws ApiError on 401', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'not authenticated' }, 401));
    const err = await apiFetch('/sessions').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toBe('not authenticated');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not redirect for non-401 errors', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'nope' }, 500));
    await expect(apiFetch('/sessions')).rejects.toMatchObject({ status: 500 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('login 401 is a normal error, not a redirect', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(login('wrong')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('login 204 resolves with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(login('right')).resolves.toBeUndefined();
  });

  it('checkAuthenticated maps 401 to false without redirecting', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(checkAuthenticated()).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(json({ authenticated: true }));
    await expect(checkAuthenticated()).resolves.toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('builds session list query strings, omitting empty params', async () => {
    fetchMock.mockImplementation(async () => json({ items: [], next_cursor: null }));
    await listSessions({ source: null, cursor: null });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sessions?limit=50&status=active');
    await listSessions({ source: ['cron', 'tui'], cursor: 'abc', status: 'archived', limit: 10 });
    expect(fetchMock.mock.calls[1]![0]).toBe(
      '/api/sessions?limit=10&cursor=abc&source=cron&source=tui&status=archived',
    );
  });

  it('buildUrl encodes values', () => {
    expect(buildUrl('/x', { q: 'a b&c' })).toBe('/api/x?q=a+b%26c');
  });
});

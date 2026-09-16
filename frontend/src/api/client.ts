/**
 * Minimal fetch wrapper for the Astra backend.
 *
 * - Always same-origin credentials (HttpOnly session cookie).
 * - Always sends `X-Requested-With: astra` (the backend's CSRF guard for mutating methods).
 * - A 401 invokes the registered unauthorized handler (redirect to /login) unless the caller
 *   opts out — e.g. the login and /auth/me calls, which treat 401 as a normal answer.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers | null;

  constructor(status: number, message: string, body: unknown = null, headers: Headers | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function isApiError(err: unknown, status?: number): err is ApiError {
  return err instanceof ApiError && (status === undefined || err.status === status);
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Register the app-wide 401 handler. Returns an unregister function. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export type QueryValue = string | number | boolean | null | undefined | string[];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  /** JSON-serialised into the request body. */
  body?: unknown;
  signal?: AbortSignal;
  /** When false, a 401 is thrown to the caller without triggering the global redirect. */
  redirectOnUnauthorized?: boolean;
}

export const API_BASE = '/api';

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== '') params.append(key, item);
      continue;
    }
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return undefined;
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return undefined;
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function errorMessage(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback || `Request failed with status ${status}`;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal, redirectOnUnauthorized = true } = options;
  const headers: Record<string, string> = {
    'X-Requested-With': 'astra',
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: payload,
    signal,
    credentials: 'same-origin',
  });

  const data = await readBody(res);

  if (!res.ok) {
    if (res.status === 401 && redirectOnUnauthorized) {
      unauthorizedHandler?.();
    }
    throw new ApiError(res.status, errorMessage(res.status, data, res.statusText), data, res.headers);
  }
  return data as T;
}

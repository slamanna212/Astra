import { apiFetch, isApiError } from './client';
import type { HealthResponse, MeResponse } from './types';

export function login(password: string): Promise<void> {
  return apiFetch<void>('/auth/login', {
    method: 'POST',
    body: { password },
    redirectOnUnauthorized: false,
  });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST', redirectOnUnauthorized: false });
}

/** Resolves true when the session cookie is valid, false on 401; other failures throw. */
export async function checkAuthenticated(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await apiFetch<MeResponse>('/auth/me', { signal, redirectOnUnauthorized: false });
    return res?.authenticated === true;
  } catch (err) {
    if (isApiError(err, 401)) return false;
    throw err;
  }
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { signal, redirectOnUnauthorized: false });
}

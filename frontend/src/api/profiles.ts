import { apiFetch } from './client';
import type { Page } from './types';

/**
 * Profiles are Bots. Everything here talks to the gateway's profile registry, which is
 * native Hermes state (`HERMES_HOME/profiles/<name>`) plus presentation metadata — never a
 * second store of its own.
 */

export interface ProfileSummary {
  name: string;
  title: string;
  description: string;
  role: 'worker' | 'orchestrator' | null;
  avatar_url: string | null;
  has_avatar: boolean;
  model: string | null;
  provider: string | null;
  is_default: boolean;
  hidden: boolean;
  section: string | null;
  bot_session_id: string | null;
  running: boolean;
  updated_at: number | null;
  preview: string | null;
  message_count: number;
  unread: boolean;
  /** False when the bot has no key of its own and no inherited provider credential. */
  credentials_ready?: boolean;
}

export interface ProfileDetail extends ProfileSummary {
  soul: string;
}

export interface ProfileCreateBody {
  name: string;
  clone_from?: string | null;
  title?: string | null;
  description?: string | null;
  soul?: string | null;
  model?: string | null;
  provider?: string | null;
}

/** Only the fields present are changed; `null` clears a presentation field. */
export interface ProfileUpdateBody {
  title?: string | null;
  description?: string | null;
  soul?: string | null;
  model?: string | null;
  provider?: string | null;
  hidden?: boolean;
  section?: string | null;
}

export interface ModelOptions {
  model: string | null;
  provider: string | null;
  aliases: { alias?: string; model?: string; provider?: string }[];
  providers: string[];
}

export function listProfiles(signal?: AbortSignal): Promise<Page<ProfileSummary>> {
  return apiFetch<{ profiles: ProfileSummary[] }>('/bots', { signal }).then((r) => ({
    items: r.profiles,
    next_cursor: null,
  }));
}

export function getProfile(name: string, signal?: AbortSignal): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>(`/bots/${encodeURIComponent(name)}`, { signal });
}

export function createProfile(body: ProfileCreateBody): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>('/bots', { method: 'POST', body });
}

export function updateProfile(name: string, body: ProfileUpdateBody): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>(`/bots/${encodeURIComponent(name)}`, { method: 'PATCH', body });
}

export function duplicateProfile(name: string, body: { name: string; title?: string }): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>(`/bots/${encodeURIComponent(name)}/duplicate`, { method: 'POST', body });
}

export function deleteProfile(name: string): Promise<void> {
  return apiFetch<void>(`/bots/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function getModelOptions(name: string, signal?: AbortSignal): Promise<ModelOptions> {
  return apiFetch<ModelOptions>(`/bots/${encodeURIComponent(name)}/model-options`, { signal });
}

/** Uploads through the same cookie+CSRF wrapper; the body is the raw file. */
export async function uploadAvatar(name: string, file: File): Promise<ProfileDetail> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/bots/${encodeURIComponent(name)}/avatar`, {
    method: 'POST',
    body: form,
    headers: { 'X-Requested-With': 'astra', Accept: 'application/json' },
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
        ? data.detail
        : `Avatar upload failed with status ${res.status}`;
    throw new Error(detail);
  }
  return data as ProfileDetail;
}

export function clearAvatar(name: string): Promise<ProfileDetail> {
  return apiFetch<ProfileDetail>(`/bots/${encodeURIComponent(name)}/avatar`, { method: 'DELETE' });
}

/** Returns the profile's canonical Bot Chat, creating it on first use. */
export function ensureBotChat(name: string): Promise<{ session_id: string; created: boolean }> {
  return apiFetch<{ session_id: string; created: boolean }>(`/bots/${encodeURIComponent(name)}/bot-chat`, {
    method: 'POST',
  });
}

export function markBotRead(name: string): Promise<void> {
  return apiFetch<void>(`/bots/${encodeURIComponent(name)}/read`, { method: 'POST' });
}

/** Avatar URLs are already absolute gateway paths, so <img src> works with the cookie. */
export function avatarSrc(
  profile: Pick<ProfileSummary, 'name' | 'avatar_url'> & Partial<Pick<ProfileSummary, 'updated_at'>>,
): string | null {
  return profile.avatar_url ? `${profile.avatar_url}?v=${encodeURIComponent(String(profile.updated_at ?? ''))}` : null;
}

export function initialsOf(profile: Pick<ProfileSummary, 'name' | 'title'>): string {
  const source = (profile.title || profile.name).trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const [first, second] = words;
  if (first && second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

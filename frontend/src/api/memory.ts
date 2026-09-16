import { apiFetch } from './client';
import type { OpenVikingContent, OpenVikingDeepSearch, OpenVikingHealth, OpenVikingSearch, OpenVikingStat, OpenVikingStatus, OpenVikingTree } from './types';

export const getOpenVikingTree = (uri: string, signal?: AbortSignal) => apiFetch<OpenVikingTree>('/openviking/tree', { query: { uri }, signal });
export const getOpenVikingStat = (uri: string, signal?: AbortSignal) => apiFetch<OpenVikingStat>('/openviking/stat', { query: { uri }, signal });
export const getOpenVikingContent = (uri: string, offset = 0, limit = 500, signal?: AbortSignal) => apiFetch<OpenVikingContent>('/openviking/content', { query: { uri, offset, limit }, signal });
export const getOpenVikingHealth = (signal?: AbortSignal) => apiFetch<OpenVikingHealth>('/openviking/health', { signal });
export const getOpenVikingStatus = (signal?: AbortSignal) => apiFetch<OpenVikingStatus>('/openviking/status', { signal });
export const searchOpenViking = (body: { query: string; mode: 'fast' | 'deep'; target_uri?: string }): Promise<OpenVikingSearch | OpenVikingDeepSearch> => apiFetch('/openviking/search', { method: 'POST', body });
export const getWorkingMemory = (signal?: AbortSignal) => apiFetch<{ files: Record<string, string> }>('/memory/files', { signal });
export const saveWorkingMemory = (which: string, content: string) => apiFetch<void>(`/memory/files/${encodeURIComponent(which)}`, { method: 'PUT', body: { content } });

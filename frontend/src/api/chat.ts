import { apiFetch, buildUrl } from './client';

export type ChatStreamEvent =
  | { type: 'state' | 'started'; running: boolean }
  | { type: 'delta'; text: string; tps?: number }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; args: string[] }
  | { type: 'clarify'; id: number; question: string; choices: unknown[] | null }
  | { type: 'approval'; request_id: string; command?: string; description?: string; pattern_keys?: string[] }
  | { type: 'subagent' | 'status'; [key: string]: unknown }
  | { type: 'done' | 'cancel' | 'error'; message?: string; late_steer?: string | null; tps?: number; output_tokens?: number };

export interface ChatOptions {
  default_model: string | null;
  default_provider: string | null;
  models: string[];
  providers: string[];
}

export function getChatOptions(sessionId: string, signal?: AbortSignal) {
  return apiFetch<ChatOptions>(`/chat/${encodeURIComponent(sessionId)}/options`, { signal });
}

export function sendChat(sessionId: string, body: { message: string; model?: string | null; provider?: string | null }) {
  return apiFetch<{ running: true }>(`/chat/${encodeURIComponent(sessionId)}/send`, { method: 'POST', body });
}

export function stopChat(sessionId: string) {
  return apiFetch<void>(`/chat/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
}

export function steerChat(sessionId: string, text: string) {
  return apiFetch<void>(`/chat/${encodeURIComponent(sessionId)}/steer`, { method: 'POST', body: { text } });
}

export function answerChat(sessionId: string, questionId: number, answer: string) {
  return apiFetch<void>(`/chat/${encodeURIComponent(sessionId)}/answer`, { method: 'POST', body: { question_id: questionId, answer } });
}

export function approveChat(sessionId: string, requestId: string, choice: 'once' | 'session' | 'always' | 'deny', reason?: string) {
  return apiFetch<void>(`/chat/${encodeURIComponent(sessionId)}/approve`, {
    method: 'POST',
    body: { request_id: requestId, choice, reason: reason || null },
  });
}

export function chatStreamUrl(sessionId: string): string {
  return buildUrl(`/chat/${encodeURIComponent(sessionId)}/stream`);
}

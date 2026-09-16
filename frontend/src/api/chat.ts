import { apiFetch, buildUrl } from './client';

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; args: string[] }
  | { type: 'clarify'; id: number; question: string; choices: unknown[] | null }
  | { type: 'done' | 'cancel' | 'error'; message?: string };

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

export function chatStreamUrl(sessionId: string): string {
  return buildUrl(`/chat/${encodeURIComponent(sessionId)}/stream`);
}

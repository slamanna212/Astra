import { apiFetch, buildUrl } from './client';

export type ChatStreamEvent =
  | { type: 'state' | 'started'; running: boolean; recovery_available?: boolean; operation?: 'chat' | 'compact' | 'regenerate' }
  | { type: 'delta'; text: string; tps?: number }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; args: string[] }
  | { type: 'clarify'; id: number; question: string; choices: unknown[] | null }
  | { type: 'approval'; request_id: string; command?: string; description?: string; pattern_keys?: string[] }
  | { type: 'status'; kind: 'status' | 'compacting' | 'compacted'; message: string }
  | { type: 'compaction'; phase: 'done'; before_messages?: number; after_messages?: number; focus_topic?: string | null }
  | { type: 'subagent'; [key: string]: unknown }
  | { type: 'done' | 'cancel' | 'error'; message?: string; error_type?: string; recovery_available?: boolean; late_steer?: string | null; tps?: number; output_tokens?: number };

export interface ChatModelOption {
  name: string;
  provider: string | null;
}

export interface ChatOptions {
  default_model: string | null;
  default_provider: string | null;
  models: ChatModelOption[];
  providers: string[];
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

interface ChatModelSettings {
  model?: string | null;
  provider?: string | null;
  reasoning_effort?: ReasoningEffort | null;
}

export function getChatOptions(sessionId: string, signal?: AbortSignal) {
  return apiFetch<ChatOptions>(`/chat/${encodeURIComponent(sessionId)}/options`, { signal });
}

export function sendChat(sessionId: string, body: { message: string } & ChatModelSettings) {
  return apiFetch<{ running: true }>(`/chat/${encodeURIComponent(sessionId)}/send`, { method: 'POST', body });
}

export function compactChat(sessionId: string, body: { focus_topic?: string | null } & ChatModelSettings) {
  return apiFetch<{ running: true }>(`/chat/${encodeURIComponent(sessionId)}/compact`, {
    method: 'POST',
    body,
  });
}

export function regenerateChat(
  sessionId: string,
  body: { message_id: number } & ChatModelSettings,
) {
  return apiFetch<{ running: true }>(`/chat/${encodeURIComponent(sessionId)}/regenerate`, {
    method: 'POST',
    body,
  });
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

export function chatStreamUrl(sessionId: string, afterSeq = 0): string {
  const url = buildUrl(`/chat/${encodeURIComponent(sessionId)}/stream`);
  if (afterSeq <= 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}after_seq=${encodeURIComponent(afterSeq)}`;
}

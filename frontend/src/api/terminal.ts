import { apiFetch, API_BASE } from './client';
import type { TerminalInfo } from './types';

export function getTerminalInfo(signal?: AbortSignal): Promise<TerminalInfo> {
  return apiFetch<TerminalInfo>('/terminal', { signal });
}

/** Same-origin WebSocket URL for the workspace shell (auth rides on the session cookie). */
export function terminalSocketUrl(params: { rows: number; cols: number; restart?: boolean }): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ rows: String(params.rows), cols: String(params.cols) });
  if (params.restart) query.set('restart', 'true');
  return `${scheme}//${window.location.host}${API_BASE}/terminal/ws?${query}`;
}

/** Close codes sent by the backend (see backend/src/astra/routes/terminal.py). */
export const TERMINAL_CLOSE = { policy: 1008, disabled: 4403, unavailable: 4503 } as const;

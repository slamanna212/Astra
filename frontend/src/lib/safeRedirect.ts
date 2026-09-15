/** Only allow same-app absolute paths as post-login redirect targets (no open redirects). */
export function safeRedirectPath(next: string | null | undefined, fallback = '/chats'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return fallback;
  return next;
}

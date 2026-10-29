/**
 * Profile (bot) scoping for the browser.
 *
 * A profile is immutable for the lifetime of a document: `/p/writer/chats` is a different
 * document from `/chats`, so switching bots is a full navigation. That is deliberate — every
 * in-flight promise, SSE stream, queued turn and cached page belongs to exactly one Hermes
 * home, and a reload is the only way to be certain none of them can be replayed against
 * another profile's state.
 *
 * The default profile keeps the original URLs (`/chats`), so existing links are unchanged.
 */

const PROFILE_SEGMENT = /^\/p\/([^/]+)(?=\/|$)/;

/** Profile named by a path. Anything without a `/p/<name>` prefix is the default profile. */
export function profileFromPath(path: string): string {
  const match = PROFILE_SEGMENT.exec(path);
  if (!match) return 'default';
  try {
    return decodeURIComponent(match[1]) || 'default';
  } catch {
    return 'default';
  }
}

/** Router basename for a profile: '' for default, '/p/<name>' otherwise. */
export function baseForProfile(name: string): string {
  return name === 'default' ? '' : `/p/${encodeURIComponent(name)}`;
}

/** Full path for `path` inside profile `name` (used for links that cross profiles). */
export function pathForProfile(name: string, path = '/'): string {
  return `${baseForProfile(name)}${path.startsWith('/') ? path : `/${path}`}`;
}

export const currentProfile = profileFromPath(window.location.pathname);
export const appBase = baseForProfile(currentProfile);

/** The current location without the profile prefix — the part that survives a bot switch. */
export function currentInProfilePath(pathname = window.location.pathname): string {
  const rest = appBase && pathname.startsWith(appBase) ? pathname.slice(appBase.length) : pathname;
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/**
 * Switch profiles by loading a new document, keeping the current section. Returns the
 * destination so callers and tests can assert on it.
 */
export function switchProfile(
  name: string,
  path = currentInProfilePath(),
  search = window.location.search,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): string {
  const destination = `${pathForProfile(name, path)}${search}`;
  navigate(destination);
  return destination;
}

export function profileStorageKey(key: string): string {
  return `astra.profile.${encodeURIComponent(currentProfile)}:${key}`;
}

export function profileQueryKey<T extends readonly unknown[]>(key: T) {
  return ['profile', currentProfile, ...key] as const;
}

/** Canonical Bot Chat: one URL per profile; the backend resolves the session behind it. */
export function botChatPath(name = currentProfile): string {
  return pathForProfile(name, '/bots/chat');
}

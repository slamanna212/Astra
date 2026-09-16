/** URI-aware parent navigation; string path helpers turn `viking://user` into invalid `viking:/`. */
export function parentVikingUri(uri: string): string {
  if (!uri.startsWith('viking://')) return 'viking://';
  const parts = uri.slice('viking://'.length).split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `viking://${parts.join('/')}` : 'viking://';
}

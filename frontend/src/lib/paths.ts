/**
 * Pure path/breadcrumb helpers for the Files browser. Display-only: the backend is the real
 * authority on traversal/containment (see backend/src/astra/files.py) — these never need to be
 * "secure", just correct for building URLs and breadcrumb labels from an already-validated
 * server response path.
 */

export interface Breadcrumb {
  label: string;
  /** Path to navigate to when this crumb is clicked (workspace-relative, no leading/trailing slash). */
  path: string;
}

/** Split a path into non-empty segments, tolerating leading/trailing/duplicate slashes. */
export function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** Join segments back into a normalized workspace-relative path ("" for the root). */
export function joinSegments(segments: string[]): string {
  return segments.join('/');
}

/** The last segment of a path, or "" for the root. */
export function basename(path: string): string {
  const segments = splitPath(path);
  return segments.length ? segments[segments.length - 1]! : '';
}

/** The parent directory of a path, or "" if already at the root. */
export function parentPath(path: string): string {
  const segments = splitPath(path);
  return joinSegments(segments.slice(0, -1));
}

/** Append a child name to a directory path. */
export function childPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** Breadcrumb trail from the workspace root down to `path`, inclusive of both ends. */
export function breadcrumbs(path: string, rootLabel = 'Workspace'): Breadcrumb[] {
  const segments = splitPath(path);
  const crumbs: Breadcrumb[] = [{ label: rootLabel, path: '' }];
  let acc = '';
  for (const segment of segments) {
    acc = childPath(acc, segment);
    crumbs.push({ label: segment, path: acc });
  }
  return crumbs;
}

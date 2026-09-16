import { describe, expect, it } from 'vitest';
import { basename, breadcrumbs, childPath, joinSegments, parentPath, splitPath } from './paths';

describe('splitPath', () => {
  it('splits on slashes and drops empty segments', () => {
    expect(splitPath('')).toEqual([]);
    expect(splitPath('a')).toEqual(['a']);
    expect(splitPath('a/b/c')).toEqual(['a', 'b', 'c']);
    expect(splitPath('/a/b/')).toEqual(['a', 'b']);
    expect(splitPath('a//b')).toEqual(['a', 'b']);
  });
});

describe('joinSegments', () => {
  it('joins with slashes, empty for no segments', () => {
    expect(joinSegments([])).toBe('');
    expect(joinSegments(['a'])).toBe('a');
    expect(joinSegments(['a', 'b'])).toBe('a/b');
  });
});

describe('basename', () => {
  it('returns the last segment, or empty for the root', () => {
    expect(basename('')).toBe('');
    expect(basename('a')).toBe('a');
    expect(basename('a/b/c.txt')).toBe('c.txt');
  });
});

describe('parentPath', () => {
  it('drops the last segment', () => {
    expect(parentPath('')).toBe('');
    expect(parentPath('a')).toBe('');
    expect(parentPath('a/b/c')).toBe('a/b');
  });
});

describe('childPath', () => {
  it('appends a name under a directory', () => {
    expect(childPath('', 'a')).toBe('a');
    expect(childPath('a', 'b')).toBe('a/b');
  });
});

describe('breadcrumbs', () => {
  it('builds the trail from root to the given path', () => {
    expect(breadcrumbs('')).toEqual([{ label: 'Workspace', path: '' }]);
    expect(breadcrumbs('a/b/c')).toEqual([
      { label: 'Workspace', path: '' },
      { label: 'a', path: 'a' },
      { label: 'b', path: 'a/b' },
      { label: 'c', path: 'a/b/c' },
    ]);
  });

  it('accepts a custom root label', () => {
    expect(breadcrumbs('a', 'Root')[0]).toEqual({ label: 'Root', path: '' });
  });

  it('tolerates leading/trailing slashes', () => {
    expect(breadcrumbs('/a/b/')).toEqual(breadcrumbs('a/b'));
  });
});

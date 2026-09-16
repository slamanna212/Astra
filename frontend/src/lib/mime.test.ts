import { describe, expect, it } from 'vitest';
import { fileKind, highlightLanguage, iconForKind } from './mime';

describe('fileKind', () => {
  it('classifies directories regardless of name', () => {
    expect(fileKind('anything', null, true)).toBe('directory');
    expect(fileKind('anything.png', 'image/png', true)).toBe('directory');
  });

  it('classifies images by mime', () => {
    expect(fileKind('photo.png', 'image/png', false)).toBe('image');
    expect(fileKind('photo.jpg', 'image/jpeg', false)).toBe('image');
  });

  it('classifies pdf by mime or extension', () => {
    expect(fileKind('doc.pdf', 'application/pdf', false)).toBe('pdf');
    expect(fileKind('doc.pdf', null, false)).toBe('pdf');
  });

  it('classifies markdown by extension', () => {
    expect(fileKind('README.md', 'text/markdown', false)).toBe('markdown');
    expect(fileKind('notes.markdown', null, false)).toBe('markdown');
  });

  it('classifies known source extensions as code', () => {
    expect(fileKind('main.py', 'text/x-python', false)).toBe('code');
    expect(fileKind('app.ts', null, false)).toBe('code');
    expect(fileKind('styles.css', 'text/css', false)).toBe('code');
  });

  it('classifies archives', () => {
    expect(fileKind('bundle.zip', 'application/zip', false)).toBe('archive');
    expect(fileKind('bundle.tar.gz', null, false)).toBe('archive');
  });

  it('falls back to text for a generic text/* mime, else other', () => {
    expect(fileKind('notes.txt', 'text/plain', false)).toBe('text');
    expect(fileKind('data.bin', 'application/octet-stream', false)).toBe('other');
    expect(fileKind('noext', null, false)).toBe('other');
  });
});

describe('iconForKind', () => {
  it('returns a distinct icon component per kind', () => {
    const kinds = ['directory', 'image', 'markdown', 'code', 'text', 'pdf', 'archive', 'other'] as const;
    const icons = kinds.map(iconForKind);
    expect(new Set(icons).size).toBe(kinds.length);
  });
});

describe('highlightLanguage', () => {
  it('maps known extensions to a highlight.js language', () => {
    expect(highlightLanguage('main.py')).toBe('python');
    expect(highlightLanguage('app.tsx')).toBe('typescript');
    expect(highlightLanguage('index.html')).toBe('xml');
  });

  it('returns null for unknown or missing extensions', () => {
    expect(highlightLanguage('README')).toBeNull();
    expect(highlightLanguage('notes.txt')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { emojiFor, markdownLines, pdfSafe, scriptSegments, textWidth, wrapRuns, type PdfLine } from './pdfLayout';

function texts(lines: PdfLine[]): string[] {
  return lines.flatMap((line) => (line.kind === 'text' ? [line.runs.map((run) => run.text).join('')] : []));
}

describe('pdf layout', () => {
  it('measures with real Helvetica widths', () => {
    expect(textWidth('i', 10, 'regular')).toBeCloseTo(2.22);
    expect(textWidth('W', 10, 'bold')).toBeCloseTo(9.44);
    expect(textWidth('abc', 10, 'mono')).toBeCloseTo(18);
  });

  it('wraps styled runs by width without losing text', () => {
    const lines = wrapRuns([{ text: 'one two three four five six', font: 'regular', ink: 'body' }], 40, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.map((run) => run.text).join('')).join(' ')).toBe('one two three four five six');
  });

  it('maps common symbols instead of dropping them', () => {
    expect(pdfSafe('a → b ≥ c · d')).toBe('a -> b >= c / d');
  });

  it('keeps Japanese instead of replacing it with question marks', () => {
    expect(pdfSafe('ｶﾞイド：「日本語」です。')).toBe('ガイド:「日本語」です。');
    expect(pdfSafe('café ©')).toBe('cafe (c)');
    expect(textWidth('日本', 10, 'regular')).toBeCloseTo(20);
    const lines = wrapRuns([{ text: 'これは長い日本語の文章です。スペースがありません。', font: 'regular', ink: 'body' }], 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.map((run) => run.text).join('')).join('')).toBe('これは長い日本語の文章です。スペースがありません。');
    // Closing punctuation never starts a line.
    for (const line of lines.slice(1)) expect(line[0]?.text[0]).not.toMatch(/[、。」]/);
  });

  it('keeps Korean composed and turns each emoji grapheme into one placeholder', () => {
    expect(pdfSafe('블랙핑크 최고')).toBe('블랙핑크 최고');
    expect(textWidth('한글', 10, 'regular')).toBeCloseTo(20);
    const safe = pdfSafe('go 👍🏽 🇯🇵!');
    expect(Array.from(safe)).toHaveLength(7);
    expect(emojiFor(safe[3]!)).toBe('👍🏽');
    expect(emojiFor(safe[5]!)).toBe('🇯🇵');
    expect(scriptSegments(`hi 안녕 日本 ${safe[3]}`).map((segment) => segment.script))
      .toEqual(['latin', 'korean', 'latin', 'japanese', 'latin', 'emoji']);
  });

  it('renders markdown structure instead of raw markup', () => {
    const lines = markdownLines([
      '## Findings',
      '',
      'Node-RED is **running** with `22.0.1` and a [guide](https://example.com).',
      '',
      '- one',
      '  - nested',
      '',
      '```',
      'kubectl get pods',
      '```',
      '',
      '| Host | IP |',
      '|---|---|',
      '| router | 10.1.10.1 |',
    ].join('\n'), 400);

    const heading = lines[0];
    expect(heading?.kind === 'text' && heading.size).toBeGreaterThan(8.5);
    expect(texts(lines)).toContain('Findings');
    expect(texts(lines).join('\n')).not.toMatch(/\*\*|##|`/);

    const paragraph = lines.find((line) => line.kind === 'text' && line.runs.some((run) => run.text === 'running'));
    expect(paragraph?.kind === 'text' && paragraph.runs.find((run) => run.text === 'running')?.font).toBe('bold');
    expect(paragraph?.kind === 'text' && paragraph.runs.find((run) => run.text === '22.0.1')?.font).toBe('mono');
    expect(texts(lines).join(' ')).toContain('(https://example.com)');

    const items = lines.filter((line) => line.kind === 'text' && line.marker);
    expect(items).toHaveLength(2);
    expect(items[1]?.kind === 'text' && items[1].indent).toBeGreaterThan(items[0]?.kind === 'text' ? items[0].indent : 0);

    expect(lines.find((line) => line.kind === 'code')).toMatchObject({ text: 'kubectl get pods' });
    const cells = lines.filter((line) => line.kind === 'cells');
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ rule: 'header' });
  });
});

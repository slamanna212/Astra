import { describe, expect, it } from 'vitest';
import { CRON_DETAIL_GROUPS, REQUIRED_SPEC_FIELDS } from './cronDetailFields';

describe('CRON_DETAIL_GROUPS', () => {
  const allTokens = CRON_DETAIL_GROUPS.flatMap((g) => g.fields.flatMap((f) => [f.key, ...(f.aliases ?? [])]));

  it.each(REQUIRED_SPEC_FIELDS)('includes the §4.5 field %s', (field) => {
    expect(allTokens).toContain(field);
  });

  it('has no duplicate keys across groups', () => {
    const keys = CRON_DETAIL_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every group has a title and at least one field', () => {
    for (const group of CRON_DETAIL_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.fields.length).toBeGreaterThan(0);
    }
  });
});

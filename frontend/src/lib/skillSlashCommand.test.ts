import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '../api/types';
import { filterAndGroupSkills } from './skillSlashCommand';

const skills: SkillSummary[] = [
  { name: 'writer', category: 'Creative', description: 'Draft clear prose', enabled: true, path: 'Creative/writer', dir_is_symlink: false, file_is_symlink: false },
  { name: 'debugger', category: 'Development', description: 'Find root causes', enabled: false, path: 'Development/debugger', dir_is_symlink: false, file_is_symlink: false },
  { name: 'notes', category: null, description: 'General notes', enabled: true, path: 'notes', dir_is_symlink: false, file_is_symlink: false },
];

describe('filterAndGroupSkills', () => {
  it('groups the complete inventory by sorted category', () => {
    expect(filterAndGroupSkills(skills, null).map((group) => group.category)).toEqual([
      'Creative',
      'Development',
      'General',
    ]);
  });

  it('filters across name, description, and category case-insensitively', () => {
    expect(filterAndGroupSkills(skills, 'ROOT')[0]?.skills[0]?.name).toBe('debugger');
    expect(filterAndGroupSkills(skills, 'creative')[0]?.skills[0]?.name).toBe('writer');
    expect(filterAndGroupSkills(skills, 'missing')).toEqual([]);
  });
});

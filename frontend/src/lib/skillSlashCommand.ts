import type { SkillSummary } from '../api/types';

export interface SkillCommandGroup {
  category: string;
  skills: SkillSummary[];
}

export interface SkillCommandExchange {
  id: number;
  command: string;
  query: string | null;
  groups: SkillCommandGroup[];
  matchCount: number;
  error: string | null;
}

export function filterAndGroupSkills(items: SkillSummary[], query: string | null): SkillCommandGroup[] {
  const needle = query?.trim().toLowerCase() ?? '';
  const filtered = needle
    ? items.filter((skill) => (
        skill.name.toLowerCase().includes(needle)
        || skill.description.toLowerCase().includes(needle)
        || (skill.category ?? '').toLowerCase().includes(needle)
      ))
    : items;
  const groups = new Map<string, SkillSummary[]>();
  for (const skill of filtered) {
    const category = skill.category || 'General';
    const skills = groups.get(category) ?? [];
    skills.push(skill);
    groups.set(category, skills);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, skills]) => ({
      category,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

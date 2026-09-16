import { apiFetch } from './client';
import type { SkillDetail, SkillListResponse } from './types';

export function listSkills(signal?: AbortSignal): Promise<SkillListResponse> {
  return apiFetch<SkillListResponse>('/skills', { signal });
}

export function getSkill(category: string | null, name: string, signal?: AbortSignal): Promise<SkillDetail> {
  const path = category
    ? `/skills/${encodeURIComponent(category)}/${encodeURIComponent(name)}`
    : `/skills/${encodeURIComponent(name)}`;
  return apiFetch<SkillDetail>(path, { signal });
}

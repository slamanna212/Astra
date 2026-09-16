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

function skillPath(category: string | null, name: string): string {
  return category
    ? `/skills/${encodeURIComponent(category)}/${encodeURIComponent(name)}`
    : `/skills/${encodeURIComponent(name)}`;
}

export function saveSkill(category: string | null, name: string, content: string): Promise<void> {
  return apiFetch<void>(skillPath(category, name), { method: 'PUT', body: { content } });
}

export function setSkillEnabled(category: string | null, name: string, enabled: boolean): Promise<void> {
  return apiFetch<void>(`${skillPath(category, name)}/enabled`, { method: 'POST', body: { enabled } });
}

export function deleteSkill(category: string | null, name: string): Promise<void> {
  return apiFetch<void>(skillPath(category, name), { method: 'DELETE' });
}

import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

it('defaults saved transcript activity to compact worklog', async () => {
  const { useUiPreferences } = await import('./uiPreferences');
  const { renderHook } = await import('@testing-library/react');
  expect(renderHook(() => useUiPreferences()).result.current.activityDisplayMode).toBe('compact_worklog');
});

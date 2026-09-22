import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import * as memory from '../../api/memory';
import MemoriesPage from './MemoriesPage';

vi.mock('../../api/memory', () => ({
  getOpenVikingTree: vi.fn(), getOpenVikingStat: vi.fn(), getOpenVikingContent: vi.fn(),
  getOpenVikingHealth: vi.fn(), getOpenVikingStatus: vi.fn(), getWorkingMemory: vi.fn(),
  saveWorkingMemory: vi.fn(), searchOpenViking: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(memory.getOpenVikingTree).mockResolvedValue({ uri: 'viking://user/default', items: [
    ...Array.from({ length: 100 }, (_, i) => ({ name: `note-${i}`, uri: `viking://user/default/note-${i}` })),
    { name: 'counted', uri: 'viking://user/default/counted', count: 7 },
  ] });
  vi.mocked(memory.getOpenVikingStat).mockResolvedValue({ count: 3 });
  vi.mocked(memory.getOpenVikingHealth).mockRejectedValue(new Error('Not configured'));
  vi.mocked(memory.getWorkingMemory).mockResolvedValue({ files: {} });
});

it('loads row statistics only on hover/focus and uses counts already in the listing', async () => {
  render(<MemoriesPage />);
  const first = await screen.findByRole('button', { name: 'Open document note-0' });
  expect(memory.getOpenVikingStat).not.toHaveBeenCalled();
  fireEvent.mouseEnter(first);
  await waitFor(() => expect(memory.getOpenVikingStat).toHaveBeenCalledTimes(1));
  expect(memory.getOpenVikingStat).toHaveBeenCalledWith('viking://user/default/note-0', expect.any(AbortSignal));
  fireEvent.focus(screen.getByRole('button', { name: 'Open document note-1' }));
  await waitFor(() => expect(memory.getOpenVikingStat).toHaveBeenCalledTimes(2));
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Open document counted, 7 indexed' }));
  expect(memory.getOpenVikingStat).toHaveBeenCalledTimes(2);
});

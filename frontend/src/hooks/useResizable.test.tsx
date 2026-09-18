import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResizeHandle } from '../components/ResizeHandle';
import { useResizable } from './useResizable';

function Harness({ inverted = false }: { inverted?: boolean }) {
  const { size, handleProps } = useResizable({ storageKey: 'test.size', axis: 'x', initial: 300, min: 200, max: 400, inverted });
  return (
    <>
      <div data-testid="panel" style={{ width: size }} />
      <ResizeHandle {...handleProps} label="Resize" />
    </>
  );
}

describe('useResizable', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the stored size, clamped', () => {
    localStorage.setItem('test.size', '9999');
    render(<Harness />);
    expect(screen.getByRole('separator', { name: 'Resize' })).toHaveAttribute('aria-valuenow', '400');
  });

  it('resizes with the keyboard, clamps, persists, and resets on double-click', () => {
    render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Resize' });
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '316');
    expect(localStorage.getItem('test.size')).toBe('316');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '300');
  });

  it('inverts direction for panels on the far side of the handle', () => {
    render(<Harness inverted />);
    const handle = screen.getByRole('separator', { name: 'Resize' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '284');
  });

  it('resizes by dragging and persists when the drag ends', () => {
    render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Resize' });
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 });
    expect(handle).toHaveAttribute('aria-valuenow', '350');
    expect(localStorage.getItem('test.size')).toBeNull();
    fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 });
    expect(localStorage.getItem('test.size')).toBe('350');
  });
});

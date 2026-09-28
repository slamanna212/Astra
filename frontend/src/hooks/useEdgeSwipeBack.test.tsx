import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';

function Harness({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEdgeSwipeBack(panel, root, { enabled: true, onBack });
  return <div ref={root} data-testid="root"><div ref={panel} data-testid="panel" /></div>;
}

const touch = (x: number, y = 100) => ({ touches: [{ clientX: x, clientY: y }] });

describe('useEdgeSwipeBack', () => {
  const matchMedia = vi.mocked(window.matchMedia);
  const original = matchMedia.getMockImplementation()!;

  beforeEach(() => {
    vi.useFakeTimers();
    matchMedia.mockImplementation((query: string) => ({ ...original(query), matches: true }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    matchMedia.mockImplementation(original);
  });

  it('follows a swipe from the left edge and goes back when released far enough', () => {
    const onBack = vi.fn();
    const { getByTestId } = render(<Harness onBack={onBack} />);
    const panel = getByTestId('panel');
    fireEvent.touchStart(panel, touch(10));
    fireEvent.touchMove(panel, touch(60));
    expect(getByTestId('root')).toHaveAttribute('data-swiping');
    fireEvent.touchMove(panel, touch(260));
    expect(panel.style.transform).toBe('translateX(250px)');
    fireEvent.touchEnd(panel, { touches: [] });
    act(() => vi.advanceTimersByTime(250));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('snaps back on a short slow swipe, and ignores touches away from the edge or vertical scrolls', () => {
    const onBack = vi.fn();
    const { getByTestId } = render(<Harness onBack={onBack} />);
    const panel = getByTestId('panel');

    fireEvent.touchStart(panel, touch(10));
    fireEvent.touchMove(panel, touch(40));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.touchEnd(panel, { touches: [] });
    act(() => vi.advanceTimersByTime(250));
    expect(panel.style.transform).toBe('');
    expect(getByTestId('root')).not.toHaveAttribute('data-swiping');

    fireEvent.touchStart(panel, touch(120));
    fireEvent.touchMove(panel, touch(300));
    expect(panel.style.transform).toBe('');

    fireEvent.touchStart(panel, touch(10, 100));
    fireEvent.touchMove(panel, touch(12, 200));
    fireEvent.touchMove(panel, touch(300, 200));
    expect(panel.style.transform).toBe('');
    expect(onBack).not.toHaveBeenCalled();
  });
});

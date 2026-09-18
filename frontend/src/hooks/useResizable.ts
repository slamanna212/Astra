import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface ResizableOptions {
  /** localStorage key the size (px) persists under; UI-only state, never sent to the backend. */
  storageKey: string;
  initial: number;
  min: number;
  /** Upper bound in px, or a function evaluated at drag time (e.g. a fraction of the viewport). */
  max: number | (() => number);
  /** 'x' resizes a width with a vertical handle, 'y' a height with a horizontal handle. */
  axis: 'x' | 'y';
  /**
   * The panel sits on the far side of the handle (right of it for 'x', below it for 'y'), so
   * dragging towards the panel shrinks it.
   */
  inverted?: boolean;
}

const KEY_STEP = 16;

function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Storage full/blocked: the size just doesn't persist.
  }
}

/** A drag-resizable panel dimension. Spread `handleProps` onto a `ResizeHandle`. */
export function useResizable({ storageKey, initial, min, max, axis, inverted = false }: ResizableOptions) {
  const resolveMax = useCallback(() => Math.max(min, typeof max === 'function' ? max() : max), [max, min]);
  const clamp = useCallback((value: number) => Math.min(resolveMax(), Math.max(min, value)), [min, resolveMax]);
  const [size, setSize] = useState(() => clamp(readStored(storageKey) ?? initial));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: number; startSize: number } | null>(null);
  const persistPending = useRef(false);

  // Persist once a drag ends (not on every pointermove).
  useEffect(() => {
    if (dragging || !persistPending.current) return;
    persistPending.current = false;
    writeStored(storageKey, size);
  }, [dragging, size, storageKey]);

  // Re-clamp when the viewport shrinks below a stored size.
  useEffect(() => {
    const onResize = () => setSize((current) => clamp(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const commit = useCallback(
    (value: number) => {
      const next = clamp(value);
      setSize(next);
      writeStored(storageKey, next);
    },
    [clamp, storageKey],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: axis === 'x' ? event.clientX : event.clientY, startSize: size };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const delta = (axis === 'x' ? event.clientX : event.clientY) - drag.current.start;
    setSize(clamp(drag.current.startSize + (inverted ? -delta : delta)));
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    persistPending.current = true;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    let next: number | null = null;
    if (event.key === grow) next = size + (inverted ? -KEY_STEP : KEY_STEP);
    else if (event.key === shrink) next = size + (inverted ? KEY_STEP : -KEY_STEP);
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = resolveMax();
    if (next === null) return;
    event.preventDefault();
    commit(next);
  };

  return {
    size,
    dragging,
    handleProps: {
      axis,
      dragging,
      value: Math.round(size),
      min,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick: () => commit(initial),
    },
  };
}

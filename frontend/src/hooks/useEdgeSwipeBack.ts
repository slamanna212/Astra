import { useEffect, useRef, type RefObject } from 'react';

/** A touch must start this close to the left edge to count as a back swipe. */
const EDGE_PX = 24;
/** Movement before deciding whether the gesture is horizontal (ours) or vertical (a scroll). */
const SLOP_PX = 8;
const SETTLE_MS = 200;

/**
 * Phone "swipe from the left edge to go back": the panel follows the finger and, released far or
 * fast enough, slides out and `onBack` runs. It drives the element's style directly so a drag
 * never re-renders the (heavy) panel. While dragging, `swipeRoot` carries `data-swiping` so CSS
 * can reveal what the panel is sliding off of. The caller resets the panel's style after `onBack`
 * takes effect with `resetEdgeSwipe`.
 */
export function useEdgeSwipeBack(
  panel: RefObject<HTMLElement | null>,
  swipeRoot: RefObject<HTMLElement | null>,
  { enabled, onBack }: { enabled: boolean; onBack: () => void },
) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    const el = panel.current;
    if (!enabled || !el) return;
    let start: { x: number; y: number; t: number } | null = null;
    let locked = false;
    let dx = 0;

    const setRoot = (on: boolean) => {
      if (on) swipeRoot.current?.setAttribute('data-swiping', '');
      else swipeRoot.current?.removeAttribute('data-swiping');
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch || touch.clientX > EDGE_PX) return;
      if (!window.matchMedia('(max-width: 47.99em)').matches) return;
      start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
      locked = false;
      dx = 0;
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!locked) {
        if (Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) {
          start = null; // A vertical scroll: leave it alone.
          return;
        }
        if (dx < SLOP_PX) return;
        locked = true;
        el.style.transition = 'none';
        el.style.willChange = 'transform';
        setRoot(true);
      }
      event.preventDefault();
      el.style.transform = `translateX(${Math.max(0, dx)}px)`;
    };

    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const wasLocked = locked;
      const elapsed = Math.max(1, event.timeStamp - start.t);
      start = null;
      locked = false;
      if (!wasLocked) return;
      const width = el.getBoundingClientRect().width;
      const commit = dx > width * 0.35 || (dx > 40 && dx / elapsed > 0.5);
      el.style.transition = `transform ${SETTLE_MS}ms ease-out`;
      el.style.transform = `translateX(${commit ? width : 0}px)`;
      window.setTimeout(() => {
        if (commit) {
          onBackRef.current();
        } else {
          resetEdgeSwipe(el, swipeRoot.current);
        }
      }, SETTLE_MS);
    };

    const onCancel = () => {
      if (locked) resetEdgeSwipe(el, swipeRoot.current);
      start = null;
      locked = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled, panel, swipeRoot]);
}

/** Put a swiped panel back in place (after navigating away, or when the swipe was abandoned). */
export function resetEdgeSwipe(panel: HTMLElement | null, swipeRoot: HTMLElement | null) {
  if (panel) {
    panel.style.transition = '';
    panel.style.transform = '';
    panel.style.willChange = '';
  }
  swipeRoot?.removeAttribute('data-swiping');
}

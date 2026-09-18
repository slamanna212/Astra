import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import classes from './ResizeHandle.module.css';

export interface ResizeHandleProps {
  axis: 'x' | 'y';
  dragging: boolean;
  value: number;
  min: number;
  label: string;
  className?: string;
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
  onDoubleClick: () => void;
}

/**
 * Draggable divider between two panels (see `useResizable`). Focusable window-splitter: arrow keys
 * nudge, Home/End jump to the limits, double-click resets to the default size.
 */
export function ResizeHandle({ axis, dragging, value, min, label, className, ...handlers }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      data-axis={axis}
      data-dragging={dragging || undefined}
      className={className ? `${classes.handle} ${className}` : classes.handle}
      title="Drag to resize · double-click to reset"
      {...handlers}
    />
  );
}

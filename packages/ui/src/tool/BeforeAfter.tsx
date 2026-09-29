'use client';

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';

/** Dark media tag over the image ("Original", "Result"); always dark, both themes (rule 5). */
export function MediaTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'absolute top-3.5 z-10 rounded-control bg-media-scrim/75 px-2 py-1.25 font-mono text-11 font-medium uppercase leading-none tracking-tag text-media-text',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Before/after comparison. Drag anywhere, or focus the handle and use the
 * arrow keys (Shift for bigger steps), Home and End.
 */
export function BeforeAfter({
  before,
  after,
  initial = 50,
  compact = false,
  className,
}: {
  before: ReactNode;
  after: ReactNode;
  initial?: number;
  /** Phone: smaller handle. */
  compact?: boolean;
  className?: string;
}) {
  const [position, setPosition] = useState(initial);
  const box = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientX);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event.clientX);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 2;
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? position - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? position + step
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 100
              : null;
    if (next === null) return;
    event.preventDefault();
    setPosition(Math.min(100, Math.max(0, next)));
  }

  return (
    <div
      ref={box}
      className={cn('touch-none overflow-hidden select-none', className ?? 'relative')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${String(100 - position)}% 0 0)` }}
      >
        {before}
      </div>
      <div
        className="absolute inset-0 checkerboard"
        style={{ clipPath: `inset(0 0 0 ${String(position)}%)` }}
      >
        {after}
      </div>
      <MediaTag className="left-3.5">Original</MediaTag>
      <MediaTag className="right-3.5">Result</MediaTag>
      <div
        aria-hidden="true"
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-media-text opacity-90"
        style={{ left: `${String(position)}%` }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare original and result"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${String(Math.round(position))}% original`}
        onKeyDown={onKeyDown}
        className={cn(
          'absolute top-1/2 z-10 flex -translate-1/2 cursor-ew-resize items-center justify-center rounded-full bg-media-text font-mono text-13 font-strong text-media-scrim',
          compact ? 'size-7.5' : 'size-9',
        )}
        style={{ left: `${String(position)}%` }}
      >
        <span aria-hidden="true" className="tracking-[-1px]">
          ‹›
        </span>
      </div>
    </div>
  );
}

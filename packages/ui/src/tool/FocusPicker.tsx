'use client';

import { focusCrop, focusOf, type Focus } from '@etb/engines';
import {
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';

export interface FocusFrame {
  label: string;
  width: number;
  height: number;
}

const percent = (value: number) => `${String(Math.round(value * 100))}%`;
const css = (value: number) => `${String(value * 100)}%`;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * P13's focal point: the image with a marker on the subject and an outline
 * for what each picked size keeps around it. Click, tap or drag to move it;
 * from the keyboard, arrows move it 2% (Shift: 10%) and Home centres it. The
 * value is "x,y", shares of the width and height.
 */
export function FocusPicker({
  src,
  value,
  frames,
  onChange,
}: {
  src: string;
  value: string | undefined;
  frames: FocusFrame[];
  onChange: (value: string) => void;
}) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  // Mid-drag the marker follows the pointer; the option changes when it's let go.
  const [dragging, setDragging] = useState<Focus | null>(null);
  const focus = dragging ?? focusOf(value);

  const commit = (next: Focus) => {
    onChange(`${clamp(next.x).toFixed(3)},${clamp(next.y).toFixed(3)}`);
  };

  const focusAt = (event: ReactPointerEvent<HTMLElement>): Focus => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  };

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Focus> = {
      ArrowLeft: { x: focus.x - step, y: focus.y },
      ArrowRight: { x: focus.x + step, y: focus.y },
      ArrowUp: { x: focus.x, y: focus.y - step },
      ArrowDown: { x: focus.x, y: focus.y + step },
      Home: { x: 0.5, y: 0.5 },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    commit(next);
  }

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    if (width > 0 && height > 0) setNatural({ width, height });
  };

  const outlines = natural
    ? frames.map((frame) => ({ frame, crop: focusCrop(natural, frame, focus) }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div
        tabIndex={0}
        role="application"
        aria-label={`Focal point, ${percent(focus.x)} across and ${percent(focus.y)} down. Click or drag on the image to move it. Arrow keys move it, Shift and an arrow move it further, Home centres it.`}
        onKeyDown={onKey}
        className="relative self-start outline-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(focusAt(event));
          }}
          onPointerMove={(event) => {
            if (dragging) setDragging(focusAt(event));
          }}
          onPointerUp={(event) => {
            if (!dragging) return;
            setDragging(null);
            commit(focusAt(event));
          }}
          onPointerCancel={() => {
            setDragging(null);
          }}
          className="block max-h-[70dvh] max-w-full cursor-crosshair touch-none border border-border select-none"
        />
        {natural &&
          outlines.map(({ frame, crop }) => (
            <span
              key={`${frame.label}-${String(frame.width)}x${String(frame.height)}`}
              aria-hidden="true"
              className="pointer-events-none absolute border border-white shadow-[0_0_0_1px_black]"
              style={{
                left: css(crop.x / natural.width),
                top: css(crop.y / natural.height),
                width: css(crop.width / natural.width),
                height: css(crop.height / natural.height),
              }}
            >
              {frames.length === 1 && (
                <span className="absolute top-1.5 left-1.5 bg-media-scrim/70 px-1.5 py-0.5 font-mono text-11.5 text-white">
                  {frame.width} × {frame.height}
                </span>
              )}
            </span>
          ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_black]"
          style={{ left: css(focus.x), top: css(focus.y) }}
        />
      </div>
      <p className="text-14 text-text-muted" aria-live="polite">
        Focal point {percent(focus.x)} across, {percent(focus.y)} down.{' '}
        {frames.length === 0
          ? 'Pick a size to see what it keeps.'
          : frames.length === 1
            ? 'The outline is what the size keeps.'
            : `The outlines are what the ${String(frames.length)} sizes keep.`}
      </p>
    </div>
  );
}

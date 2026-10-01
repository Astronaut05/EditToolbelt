'use client';

import {
  drawMark,
  drawMarks,
  MARK_TOOLS,
  nextMarker,
  type Mark,
  type MarkTool,
  type Point,
  type Size,
} from '@etb/engines';
import {
  ArrowUpRight,
  Circle,
  Hash,
  Highlighter,
  Minus,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import { cn } from '../cn';
import { ColorInput, Slider } from '../primitives/fields';

const icon = (Icon: typeof Pencil) => <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;

const TOOLS: Record<MarkTool, { label: string; icon: ReactNode }> = {
  brush: { label: 'Brush', icon: icon(Pencil) },
  highlighter: { label: 'Highlighter', icon: icon(Highlighter) },
  line: { label: 'Line', icon: icon(Minus) },
  arrow: { label: 'Arrow', icon: icon(ArrowUpRight) },
  rect: { label: 'Rectangle', icon: icon(Square) },
  ellipse: { label: 'Ellipse', icon: icon(Circle) },
  marker: { label: 'Numbered marker', icon: icon(Hash) },
};

/** A press that moves less than this (screen px) is a click: shapes then take two clicks. */
const CLICK_PX = 4;

export interface DrawStyle {
  tool: MarkTool;
  color: string;
  /** Image pixels. */
  size: number;
  /** 0-1. */
  opacity: number;
}

/** The pen's first size for an image: thin enough to annotate, thick enough to see. */
export const defaultSize = (natural: Size) =>
  Math.max(2, Math.round(Math.max(natural.width, natural.height) / 250));

/** The draw mode's own toolbar: the tool, its colour, size and opacity, and clearing. */
export function DrawBar({
  style,
  onStyle,
  maxSize,
  canClear,
  onClear,
}: {
  style: DrawStyle;
  onStyle: (style: DrawStyle) => void;
  maxSize: number;
  canClear: boolean;
  onClear: () => void;
}) {
  const sizeId = useId();
  const opacityId = useId();
  return (
    <div className="flex min-h-12 flex-none flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-bg px-3 py-1">
      <div role="radiogroup" aria-label="Draw with" className="flex items-center">
        {MARK_TOOLS.map((tool) => {
          const chosen = style.tool === tool;
          return (
            <button
              key={tool}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={TOOLS[tool].label}
              title={TOOLS[tool].label}
              tabIndex={chosen ? 0 : -1}
              onClick={() => {
                onStyle({ ...style, tool });
              }}
              onKeyDown={(event) => {
                const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                if (!step) return;
                event.preventDefault();
                const index = MARK_TOOLS.indexOf(tool);
                const next = MARK_TOOLS[(index + step + MARK_TOOLS.length) % MARK_TOOLS.length];
                if (next) onStyle({ ...style, tool: next });
                const group = event.currentTarget.parentElement;
                requestAnimationFrame(() => {
                  group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
                });
              }}
              className={cn(
                'inline-flex size-11 items-center justify-center',
                chosen ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-control',
                  chosen && 'bg-surface ring-1 ring-text',
                )}
              >
                {TOOLS[tool].icon}
              </span>
            </button>
          );
        })}
      </div>
      <ColorInput
        label="Colour"
        value={style.color}
        onChange={(color) => {
          onStyle({ ...style, color });
        }}
      />
      <span className="flex items-center gap-2">
        <label htmlFor={sizeId} className="text-14 text-text-muted">
          Size
        </label>
        <Slider
          id={sizeId}
          min={1}
          max={maxSize}
          value={style.size}
          onChange={(event) => {
            onStyle({ ...style, size: Number(event.target.value) });
          }}
          className="w-28"
        />
        <output htmlFor={sizeId} className="w-12 font-mono text-12.5">
          {style.size} px
        </output>
      </span>
      <span className="flex items-center gap-2">
        <label htmlFor={opacityId} className="text-14 text-text-muted">
          Opacity
        </label>
        <Slider
          id={opacityId}
          min={10}
          max={100}
          step={5}
          value={Math.round(style.opacity * 100)}
          onChange={(event) => {
            onStyle({ ...style, opacity: Number(event.target.value) / 100 });
          }}
          className="w-24"
        />
        <output htmlFor={opacityId} className="w-10 font-mono text-12.5">
          {Math.round(style.opacity * 100)}%
        </output>
      </span>
      <button
        type="button"
        disabled={!canClear}
        onClick={onClear}
        className="ml-auto inline-flex h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text disabled:opacity-38"
      >
        {icon(Trash2)}
        Clear all
      </button>
    </div>
  );
}

/**
 * The drawing surface over the image: a canvas the marks are drawn on at the
 * screen's scale, with the same code the export uses. Drag to draw; a shape
 * can also be made with two clicks (its start, then its end), and a marker
 * with one, so nothing needs a drag.
 */
export function DrawLayer({
  natural,
  marks,
  style,
  onMarks,
}: {
  natural: Size;
  marks: readonly Mark[];
  style: DrawStyle;
  /** `transient` while a stroke is under way; the last call of a stroke is one undo step. */
  onMarks: (marks: Mark[], transient?: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pending, setPending] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // Redraw at the canvas's own pixel size whenever the marks or its size change.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => {
      const rect = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(element.clientWidth * ratio));
      const height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      const ctx = element.getContext('2d');
      if (!ctx || rect.width === 0) return;
      ctx.clearRect(0, 0, width, height);
      const scale = width / natural.width;
      drawMarks(ctx, marks, scale);
      if (pending && cursor && style.tool !== 'brush' && style.tool !== 'highlighter') {
        drawMark(ctx, { ...style, points: [pending, cursor] }, scale);
      }
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [marks, natural, pending, cursor, style]);

  /** A pointer's place in image pixels. */
  const at = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    const x = ((event.clientX - rect.left) / rect.width) * natural.width;
    const y = ((event.clientY - rect.top) / rect.height) * natural.height;
    return [
      Math.round(Math.min(natural.width, Math.max(0, x)) * 10) / 10,
      Math.round(Math.min(natural.height, Math.max(0, y)) * 10) / 10,
    ];
  };

  const mark = (points: Point[]): Mark => ({
    tool: style.tool,
    points,
    color: style.color,
    size: style.size,
    opacity: style.opacity,
    ...(style.tool === 'marker' && { n: nextMarker(marks) }),
  });

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = at(event);
    if (style.tool === 'marker') {
      onMarks([...marks, mark([start])]);
      return;
    }
    // The second click of a two-click shape.
    if (pending) {
      onMarks([...marks, mark([pending, start])]);
      setPending(null);
      return;
    }
    const pointer = event.pointerId;
    const downX = event.clientX;
    const downY = event.clientY;
    let points: Point[] = [start];
    let moved = false;
    const follow = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) < CLICK_PX) return;
      moved = true;
      const point = at(e);
      points =
        style.tool === 'brush' || style.tool === 'highlighter'
          ? [...points, point]
          : [start, point];
      onMarks([...marks, mark(points)], true);
    };
    const stop = () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      stop();
      if (moved || style.tool === 'brush' || style.tool === 'highlighter') {
        // A click with a brush makes a dot.
        onMarks([...marks, mark(points)]);
      } else {
        setPending(start);
        setCursor(start);
      }
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={`Drawing area, ${String(marks.length)} ${marks.length === 1 ? 'mark' : 'marks'}`}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (pending) setCursor(at(event));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && pending) {
          event.stopPropagation();
          setPending(null);
        }
      }}
      tabIndex={-1}
      className="absolute inset-0 size-full cursor-crosshair touch-none"
    />
  );
}

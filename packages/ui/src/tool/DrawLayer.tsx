'use client';

import {
  drawMark,
  drawMarks,
  MARK_TOOLS,
  markBounds,
  moveMark,
  nextMarker,
  resizeMark,
  type Mark,
  type MarkTool,
  type Point,
  type Size,
  type Upright,
} from '@etb/engines';
import {
  ArrowUpRight,
  Circle,
  Hash,
  Highlighter,
  Minus,
  Pencil,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { ColorInput, Slider } from '../primitives/fields';
import { baseOf, boxMapping, type Nudge, type ToImage } from './mapping';

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

/** What "Add" makes with each tool, from the keyboard. */
const ADD_LABELS: Record<MarkTool, string> = {
  brush: 'Add stroke',
  highlighter: 'Add highlight',
  line: 'Add line',
  arrow: 'Add arrow',
  rect: 'Add rectangle',
  ellipse: 'Add ellipse',
  marker: 'Add marker',
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

/** The largest pen size for an image, px. */
export const maxPenSize = (natural: Size) =>
  Math.max(20, Math.round(Math.max(natural.width, natural.height) / 20));

/** A new mark in the pen's style: a marker gets the next number, and an upright base in a turned photo. */
export function newMark(
  style: DrawStyle,
  points: Point[],
  marks: readonly Mark[],
  upright?: Upright,
): Mark {
  const base = style.tool === 'marker' ? baseOf(upright) : undefined;
  return {
    tool: style.tool,
    points,
    color: style.color,
    size: style.size,
    opacity: style.opacity,
    ...(style.tool === 'marker' && { n: nextMarker(marks) }),
    ...(base && { base }),
  };
}

const round = (v: number) => Math.round(v);

/** A mark's place, for its label: "from 150, 150 to 250, 150", "100 × 75 px at 150, 113". */
function markPlace(mark: Mark): string {
  const [a] = mark.points;
  const b = mark.points[mark.points.length - 1] ?? a;
  if (!a || !b) return '';
  if (mark.tool === 'marker') {
    return `number ${String(mark.n ?? 1)} at ${String(round(a[0]))}, ${String(round(a[1]))}`;
  }
  if (mark.tool === 'line' || mark.tool === 'arrow') {
    return `from ${String(round(a[0]))}, ${String(round(a[1]))} to ${String(round(b[0]))}, ${String(round(b[1]))}`;
  }
  const xs = mark.points.map((p) => p[0]);
  const ys = mark.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return `${String(round(Math.max(...xs) - x))} × ${String(round(Math.max(...ys) - y))} px at ${String(round(x))}, ${String(round(y))}`;
}

/**
 * The draw mode's own toolbar: the tool, its colour, size and opacity, a
 * mark added from the keyboard ("Add arrow"), and clearing.
 */
export function DrawBar({
  style,
  onStyle,
  maxSize,
  canClear,
  onClear,
  onAdd,
}: {
  style: DrawStyle;
  onStyle: (style: DrawStyle) => void;
  maxSize: number;
  canClear: boolean;
  onClear: () => void;
  /** Adds a mark of the current tool in the middle of the image. */
  onAdd: () => void;
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
      <span className="ml-auto flex items-center">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text"
        >
          {icon(Plus)}
          {ADD_LABELS[style.tool]}
        </button>
        <button
          type="button"
          disabled={!canClear}
          onClick={onClear}
          className="inline-flex h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text disabled:opacity-38"
        >
          {icon(Trash2)}
          Clear all
        </button>
      </span>
    </div>
  );
}

/**
 * The drawing surface over the image: a canvas the marks are drawn on at the
 * screen's scale, with the same code the export uses. Drag to draw; a shape
 * can also be made with two clicks (its start, then its end), and a marker
 * with one, so nothing needs a drag. From the keyboard, each mark can be
 * focused (Tab) and moved with the arrow keys (Shift: 10 px); Alt and the
 * arrows change its size, and Delete removes it.
 */
export function DrawLayer({
  natural,
  marks,
  style,
  onMarks,
  toImage,
  upright,
  nudge,
  active = true,
}: {
  natural: Size;
  marks: readonly Mark[];
  style: DrawStyle;
  /** P01: the editor's pointer mapping, its turns and flips undone. */
  toImage?: ToImage;
  /** P01: keeps a new marker's number upright in the editor's frame. */
  upright?: Upright;
  /** P01: arrow-key moves taken into the image's own pixels. */
  nudge?: Nudge;
  /** Draw mode: the marks can be focused and moved from the keyboard. */
  active?: boolean;
  /** `transient` while a stroke is under way; the last call of a stroke is one undo step. */
  onMarks: (marks: Mark[], transient?: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hintId = useId();
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
    const [x, y] = (toImage ?? boxMapping(canvas.current, natural))(event.clientX, event.clientY);
    return [
      Math.round(Math.min(natural.width, Math.max(0, x)) * 10) / 10,
      Math.round(Math.min(natural.height, Math.max(0, y)) * 10) / 10,
    ];
  };

  const mark = (points: Point[]): Mark => newMark(style, points, marks, upright);

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

  /** Focus on mark `index` once it's drawn, or on the drawing area when none is left. */
  const focusMark = (index: number) => {
    requestAnimationFrame(() => {
      const target =
        canvas.current?.parentElement?.querySelector<HTMLElement>(
          `[data-mark="${String(index)}"]`,
        ) ?? canvas.current;
      target?.focus();
    });
  };

  function onMarkKey(event: KeyboardEvent<HTMLElement>, index: number) {
    const target = marks[index];
    if (!target) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onMarks(marks.filter((_, i) => i !== index));
      // The next mark takes its place in the order; after the last, the one before.
      if (marks.length > 1) focusMark(Math.min(index, marks.length - 2));
      else focusMark(-1);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const move = (
      {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      } as Record<string, [number, number] | undefined>
    )[event.key];
    if (!move) return;
    event.preventDefault();
    const [dx, dy] = nudge ? nudge(move[0], move[1]) : move;
    // A marker grows with → and ↑ on screen, whatever the photo's turn.
    const grow =
      (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1) * (step === 1 ? 1 : 4);
    const next = event.altKey
      ? resizeMark(target, dx, dy, natural, grow, maxPenSize(natural))
      : moveMark(target, dx, dy, natural);
    onMarks(marks.map((m, i) => (i === index ? next : m)));
  }

  const pct = (value: number, of: number) => `${String((value / of) * 100)}%`;
  return (
    <>
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
      {active && marks.length > 0 && (
        <>
          <span id={hintId} className="sr-only">
            Arrow keys move it, Shift moves 10 px. Alt and the arrow keys change its size. Delete
            removes it.
          </span>
          {marks.map((item, index) => {
            const box = markBounds(item);
            return (
              <div
                key={index}
                role="group"
                tabIndex={0}
                data-mark={index}
                aria-label={`${TOOLS[item.tool].label} ${String(index + 1)}, ${markPlace(item)}`}
                aria-describedby={hintId}
                onKeyDown={(event) => {
                  onMarkKey(event, index);
                }}
                // The pointer draws on the canvas underneath, over marks too.
                className="pointer-events-none absolute outline-offset-2"
                style={{
                  left: pct(box.x, natural.width),
                  top: pct(box.y, natural.height),
                  width: pct(box.width, natural.width),
                  height: pct(box.height, natural.height),
                }}
              />
            );
          })}
        </>
      )}
    </>
  );
}

'use client';

import {
  applyAdjust,
  applyRedact,
  areaBoxOf,
  REDACT_EFFECTS,
  REDACT_SHAPES,
  type Adjust,
  type FaceBox,
  type Point,
  type Redact,
  type RedactEffect,
  type Redaction,
  type RedactShape,
  type Size,
} from '@etb/engines';
import { Circle, Paintbrush, ScanFace, Square, SquarePlus, Trash2 } from 'lucide-react';
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
import { boxMapping, type Nudge, type ToImage } from './mapping';

const icon = (Icon: typeof Square) => <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;

const SHAPES: Record<RedactShape, { label: string; icon: ReactNode }> = {
  rect: { label: 'Box', icon: icon(Square) },
  ellipse: { label: 'Ellipse', icon: icon(Circle) },
  brush: { label: 'Brush', icon: icon(Paintbrush) },
};

const EFFECTS: Record<RedactEffect, string> = {
  blur: 'Blur',
  pixelate: 'Pixelate',
  solid: 'Solid',
};

/** A press that moves less than this (screen px) is a click: a box then takes two clicks. */
const CLICK_PX = 4;

/** Finds faces in the image at `src`; the page supplies it (the model lives under MODELS_BASE_URL). */
export type FaceFinder = (
  src: string,
  signal: AbortSignal,
  onProgress: (progress: { label: string; amount?: string; fraction: number }) => void,
) => Promise<FaceBox[]>;

export type FaceSearch =
  | { kind: 'idle' }
  | { kind: 'running'; label: string; amount?: string }
  | { kind: 'done'; count: number }
  | { kind: 'error'; message: string };

export interface BlurPen {
  shape: RedactShape;
  /** The brush's width, image px. */
  brush: number;
}

/** What a search says, for the bar's live region. */
function searchText(search: FaceSearch): string {
  if (search.kind === 'running') {
    return `${search.label}${search.amount ? ` · ${search.amount}` : ''}`;
  }
  if (search.kind === 'error') return `${search.message}. Draw a box over each face instead.`;
  if (search.kind === 'done') {
    if (search.count === 0) return 'No faces found. Draw a box over any you want hidden.';
    return `${String(search.count)} ${search.count === 1 ? 'face' : 'faces'} found and hidden. Tap one to leave it as it is.`;
  }
  return '';
}

/** A radio group of buttons with arrow-key movement, as the draw bar's tools. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (value: T, chosen: boolean) => ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center">
      {options.map((option) => {
        const chosen = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => {
              onChange(option);
            }}
            onKeyDown={(event) => {
              const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
              if (!step) return;
              event.preventDefault();
              const next =
                options[(options.indexOf(option) + step + options.length) % options.length];
              if (next) onChange(next);
              const group = event.currentTarget.parentElement;
              requestAnimationFrame(() => {
                group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
              });
            }}
            className={cn(
              'inline-flex h-11 min-w-11 items-center justify-center',
              chosen ? 'text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {render(option, chosen)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The blur mode's toolbar: the shape to draw (box, ellipse, brush), the
 * effect for every area (blur, pixelate, solid) and its strength in px,
 * "Find faces", a box added from the keyboard, and clearing.
 */
export function BlurBar({
  pen,
  onPen,
  redact,
  onRedact,
  natural,
  maxStrength,
  search,
  onFind,
  onAddBox,
}: {
  pen: BlurPen;
  onPen: (pen: BlurPen) => void;
  redact: Redact;
  /** `transient` while a slider moves; letting go makes it one undo step. */
  onRedact: (redact: Redact, transient?: boolean) => void;
  natural: Size;
  maxStrength: number;
  search: FaceSearch;
  /** Absent when the page has no face finder. */
  onFind?: () => void;
  onAddBox: () => void;
}) {
  const strengthId = useId();
  const brushId = useId();
  const setAmount = (value: number, done: boolean) => {
    onRedact({ ...redact, amount: Math.max(1, Math.round(value)) }, !done);
  };
  const text = searchText(search);
  return (
    <div className="flex flex-none flex-col border-b border-border bg-bg">
      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1">
        <Choice
          label="Draw"
          options={REDACT_SHAPES}
          value={pen.shape}
          onChange={(shape) => {
            onPen({ ...pen, shape });
          }}
          render={(shape, chosen) => (
            <span
              title={SHAPES[shape].label}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-control',
                chosen && 'bg-surface ring-1 ring-text',
              )}
            >
              {SHAPES[shape].icon}
              <span className="sr-only">{SHAPES[shape].label}</span>
            </span>
          )}
        />
        {pen.shape === 'brush' && (
          <span className="flex items-center gap-2">
            <label htmlFor={brushId} className="text-14 text-text-muted">
              Brush
            </label>
            <Slider
              id={brushId}
              min={2}
              max={Math.max(40, Math.round(Math.max(natural.width, natural.height) / 6))}
              value={pen.brush}
              onChange={(event) => {
                onPen({ ...pen, brush: Number(event.target.value) });
              }}
              className="w-24"
            />
            <output htmlFor={brushId} className="w-14 font-mono text-12.5">
              {pen.brush} px
            </output>
          </span>
        )}
        <Choice
          label="Effect"
          options={REDACT_EFFECTS}
          value={redact.effect}
          onChange={(effect) => {
            onRedact({ ...redact, effect });
          }}
          render={(effect, chosen) => (
            <span
              className={cn(
                'inline-flex h-8 items-center rounded-control px-2.5 text-14',
                chosen && 'bg-surface font-strong ring-1 ring-text',
              )}
            >
              {EFFECTS[effect]}
            </span>
          )}
        />
        {redact.effect === 'solid' ? (
          <ColorInput
            label="Colour"
            value={redact.color}
            onChange={(color) => {
              onRedact({ ...redact, color });
            }}
          />
        ) : (
          <span className="flex items-center gap-2">
            <label htmlFor={strengthId} className="text-14 text-text-muted">
              {redact.effect === 'pixelate' ? 'Block' : 'Strength'}
            </label>
            <Slider
              id={strengthId}
              min={2}
              max={maxStrength}
              value={Math.min(maxStrength, redact.amount)}
              aria-valuetext={`${String(redact.amount)} px`}
              onChange={(event) => {
                setAmount(Number(event.target.value), false);
              }}
              onPointerUp={(event) => {
                setAmount(Number(event.currentTarget.value), true);
              }}
              onKeyUp={(event) => {
                setAmount(Number(event.currentTarget.value), true);
              }}
              className="w-28"
            />
            <output htmlFor={strengthId} className="w-14 font-mono text-12.5">
              {redact.amount} px
            </output>
          </span>
        )}
        <span className="ml-auto flex items-center">
          {onFind && (
            <button
              type="button"
              disabled={search.kind === 'running'}
              onClick={onFind}
              className="inline-flex h-11 items-center gap-2 px-2 text-14 font-strong text-text hover:underline disabled:opacity-38"
            >
              {icon(ScanFace)}
              Find faces
            </button>
          )}
          <button
            type="button"
            onClick={onAddBox}
            className="inline-flex h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text"
          >
            {icon(SquarePlus)}
            Add box
          </button>
          <button
            type="button"
            disabled={redact.areas.length === 0}
            onClick={() => {
              onRedact({ ...redact, areas: [] });
            }}
            className="inline-flex h-11 items-center gap-2 px-2 text-14 text-text-muted hover:text-text disabled:opacity-38"
          >
            {icon(Trash2)}
            Clear all
          </button>
        </span>
      </div>
      <p role="status" className={cn('px-4 pb-2 text-12.5 text-text-muted', !text && 'sr-only')}>
        {text}
      </p>
    </div>
  );
}

/** A drawn box or ellipse's size and place, for its label: "120 × 80 px at 40, 60". */
function areaLabel(area: Redaction): string {
  const [a, b] = area.points;
  if (!a || !b) return '';
  const x = Math.round(Math.min(a[0], b[0]));
  const y = Math.round(Math.min(a[1], b[1]));
  const w = Math.round(Math.abs(b[0] - a[0]));
  const h = Math.round(Math.abs(b[1] - a[1]));
  return `${String(w)} × ${String(h)} px at ${String(x)}, ${String(y)}`;
}

/** The area moved by (dx, dy) or, with `grow`, its far corner moved: kept inside the image. */
export function nudgeArea(
  area: Redaction,
  dx: number,
  dy: number,
  natural: Size,
  grow = false,
): Redaction {
  const [a, b] = area.points;
  if (!a || !b) return area;
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  if (grow) {
    return {
      ...area,
      points: [
        [x0, y0],
        [
          Math.min(natural.width, Math.max(x0 + 2, x1 + dx)),
          Math.min(natural.height, Math.max(y0 + 2, y1 + dy)),
        ],
      ],
    };
  }
  const mx = Math.min(natural.width - x1, Math.max(-x0, dx));
  const my = Math.min(natural.height - y1, Math.max(-y0, dy));
  return {
    ...area,
    points: [
      [x0 + mx, y0 + my],
      [x1 + mx, y1 + my],
    ],
  };
}

/** A box a quarter of the image across, in its middle: "Add box" from the keyboard. */
export function centredBox(natural: Size): Redaction {
  const w = Math.round(natural.width / 4);
  const h = Math.round(natural.height / 4);
  const x = Math.round((natural.width - w) / 2);
  const y = Math.round((natural.height - h) / 2);
  return {
    shape: 'rect',
    points: [
      [x, y],
      [x + w, y + h],
    ],
  };
}

/**
 * The areas over the image: the photo redrawn on a canvas at the screen's
 * scale with the export's own code, so the preview is the file. Drag to draw
 * a box, ellipse or brush stroke (a box also takes two clicks). Found faces
 * are buttons that turn hiding on and off; drawn boxes and ellipses can be
 * focused and moved with the arrow keys (Alt and the arrows change the size,
 * Delete removes one).
 */
export function BlurLayer({
  src,
  natural,
  adjust,
  redact,
  pen,
  active,
  onRedact,
  toImage,
  nudge,
}: {
  src: string;
  natural: Size;
  /** P01: the editor's pointer mapping, its turns and flips undone. */
  toImage?: ToImage;
  /** P01: arrow-key moves taken into the image's own pixels. */
  nudge?: Nudge;
  /** P01: the photo's adjustments, previewed with the export's code before the areas. */
  adjust?: Adjust;
  redact: Redact;
  pen: BlurPen;
  /** Blur mode: the layer takes the pointer and shows its controls. */
  active: boolean;
  /** `transient` while a stroke is under way; the last call of a stroke is one undo step. */
  onRedact: (redact: Redact, transient?: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [pending, setPending] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const base = useRef<{ key: string; pixels: ImageData } | null>(null);

  useEffect(() => {
    let live = true;
    const image = new Image();
    image.src = src;
    image.decode().then(
      () => {
        if (live) setPhoto(image);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [src]);

  // Redraw at the canvas's own pixel size whenever the areas, effect or size change.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !photo) return;
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(element.clientWidth * ratio));
      const height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      const ctx = element.getContext('2d', { willReadFrequently: true });
      if (!ctx || element.clientWidth === 0) return;
      const key = `${String(width)}x${String(height)}`;
      if (base.current?.key !== key) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(photo, 0, 0, width, height);
        base.current = { key, pixels: ctx.getImageData(0, 0, width, height) };
      }
      const pixels = new ImageData(new Uint8ClampedArray(base.current.pixels.data), width, height);
      const scale = width / natural.width;
      if (adjust) applyAdjust(pixels.data, adjust);
      const preview =
        pending && cursor && pen.shape !== 'brush'
          ? [...redact.areas, { shape: pen.shape, points: [pending, cursor] }]
          : redact.areas;
      applyRedact(pixels, { ...redact, areas: preview }, scale);
      ctx.putImageData(pixels, 0, 0);
      if (!active) return;
      // Each drawn area's outline, so its edge shows on a soft blur.
      ctx.save();
      ctx.lineWidth = Math.max(1, ratio);
      ctx.setLineDash([4 * ratio, 4 * ratio]);
      for (const area of preview) {
        // Faces have their own buttons; a brush stroke shows by itself.
        if (area.face !== undefined || area.shape === 'brush') continue;
        const box = areaBoxOf(area, scale);
        if (!box) continue;
        for (const [color, offset] of [
          ['rgba(255,255,255,0.9)', 0],
          ['rgba(0,0,0,0.6)', 4 * ratio],
        ] as const) {
          ctx.strokeStyle = color;
          ctx.lineDashOffset = offset;
          ctx.beginPath();
          if (area.shape === 'ellipse') {
            ctx.ellipse(
              box.x + box.width / 2,
              box.y + box.height / 2,
              Math.max(0, box.width / 2 - 0.5),
              Math.max(0, box.height / 2 - 0.5),
              0,
              0,
              Math.PI * 2,
            );
          } else {
            ctx.rect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [photo, adjust, redact, natural, pending, cursor, pen.shape, active]);

  /** A pointer's place in image pixels. */
  const at = (event: { clientX: number; clientY: number }): Point => {
    const [x, y] = (toImage ?? boxMapping(canvas.current, natural))(event.clientX, event.clientY);
    return [
      Math.round(Math.min(natural.width, Math.max(0, x))),
      Math.round(Math.min(natural.height, Math.max(0, y))),
    ];
  };

  const area = (points: Point[]): Redaction => ({
    shape: pen.shape,
    points,
    ...(pen.shape === 'brush' && { size: pen.brush }),
  });
  const withArea = (next: Redaction): Redact => ({ ...redact, areas: [...redact.areas, next] });

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = at(event);
    // The second click of a two-click box.
    if (pending) {
      onRedact(withArea(area([pending, start])));
      setPending(null);
      return;
    }
    const pointer = event.pointerId;
    const downX = event.clientX;
    const downY = event.clientY;
    let points: Point[] = [start];
    let moved = false;
    const brush = pen.shape === 'brush';
    const follow = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) < CLICK_PX) return;
      moved = true;
      const point = at(e);
      points = brush ? [...points, point] : [start, point];
      onRedact(withArea(area(points)), true);
    };
    const stop = () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      stop();
      if (moved || brush) {
        // A click with the brush makes a dot.
        onRedact(withArea(area(points)));
      } else {
        setPending(start);
        setCursor(start);
      }
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onAreaKey(event: KeyboardEvent<HTMLElement>, index: number) {
    const target = redact.areas[index];
    if (!target) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRedact({ ...redact, areas: redact.areas.filter((_, i) => i !== index) });
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
    const next = nudgeArea(target, Math.round(dx), Math.round(dy), natural, event.altKey);
    onRedact({ ...redact, areas: redact.areas.map((a, i) => (i === index ? next : a)) });
  }

  const pct = (value: number, of: number) => `${String((value / of) * 100)}%`;
  const hidden = redact.areas.filter((a) => !a.off).length;
  let faceNumber = 0;
  return (
    <>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Photo with ${String(hidden)} hidden ${hidden === 1 ? 'area' : 'areas'}`}
        onPointerDown={active ? onPointerDown : undefined}
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
        className={cn('absolute inset-0 size-full touch-none', active && 'cursor-crosshair')}
      />
      {active &&
        redact.areas.map((item, index) => {
          const [a, b] = item.points;
          if (!a || !b || item.shape === 'brush') return null;
          const style = {
            left: pct(Math.min(a[0], b[0]), natural.width),
            top: pct(Math.min(a[1], b[1]), natural.height),
            width: pct(Math.abs(b[0] - a[0]), natural.width),
            height: pct(Math.abs(b[1] - a[1]), natural.height),
          };
          if (item.face !== undefined) {
            faceNumber += 1;
            const n = faceNumber;
            return (
              <button
                key={`face-${String(index)}`}
                type="button"
                aria-pressed={!item.off}
                aria-label={`Hide face ${String(n)}`}
                onClick={() => {
                  onRedact({
                    ...redact,
                    areas: redact.areas.map((x, i) => (i === index ? { ...x, off: !x.off } : x)),
                  });
                }}
                className={cn(
                  'absolute rounded-[50%] border-2 outline-offset-2',
                  item.off
                    ? 'border-dashed border-media-text/80 shadow-[0_0_0_1px_var(--media-scrim)]'
                    : 'border-media-text shadow-[0_0_0_1px_var(--media-scrim)]',
                )}
                style={style}
              >
                <span
                  aria-hidden="true"
                  className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full rounded-control bg-media-scrim/80 px-1.5 py-0.5 font-mono text-11 leading-none whitespace-nowrap text-media-text"
                >
                  {item.off ? `Face ${String(n)} · shown` : `Face ${String(n)}`}
                </span>
              </button>
            );
          }
          return (
            <div
              key={`area-${String(index)}`}
              role="group"
              tabIndex={0}
              aria-label={`${item.shape === 'ellipse' ? 'Ellipse' : 'Box'} ${String(index + 1)}, ${areaLabel(item)}. Arrow keys move it, Shift moves 10 px, Alt and the arrows change its size, Delete removes it.`}
              onKeyDown={(event) => {
                onAreaKey(event, index);
              }}
              className="pointer-events-none absolute outline-offset-2"
              style={style}
            />
          );
        })}
    </>
  );
}

export type { FaceBox };

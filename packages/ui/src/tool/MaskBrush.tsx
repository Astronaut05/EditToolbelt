'use client';

import { Eraser, Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';

import { Slider } from '../primitives/fields';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { MediaTag } from './BeforeAfter';
import { addPoint, drawStrokes, type MaskMode, type MaskStroke } from './brush';
import { IconButton } from './CanvasEditor';

const MODES = [
  { value: 'mark', label: 'Mark' },
  { value: 'unmark', label: 'Unmark' },
] as const;

/** Space around the image inside the frame, px. */
const GUTTER = 24;

/**
 * The mask brush over an image (tools/photo.md → P17): paint over what to
 * remove, a little past its edges; Unmark takes parts back. The marked area
 * shows as a tint; each change goes to the page at once (strokes in image px,
 * the same strokes the page draws into the mask it sends). Brush size is in
 * screen px, so it feels the same at any zoom.
 */
export function MaskBrush({
  src,
  width,
  height,
  strokes,
  onChange,
}: {
  src: string;
  /** The image's size as shown (EXIF orientation applied), when the page has read it. */
  width?: number;
  height?: number;
  strokes: MaskStroke[];
  onChange: (strokes: MaskStroke[]) => void;
}) {
  // Without a size from the page, the picture's own (browsers apply EXIF orientation).
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (width && height) return;
    const picture = new Image();
    picture.onload = () => {
      setNatural({ width: picture.naturalWidth, height: picture.naturalHeight });
    };
    picture.src = src;
  }, [src, width, height]);
  const size = width && height ? { width, height } : natural;
  return size ? (
    <BrushCanvas
      src={src}
      width={size.width}
      height={size.height}
      strokes={strokes}
      onChange={onChange}
    />
  ) : null;
}

function BrushCanvas({
  src,
  width,
  height,
  strokes,
  onChange,
}: {
  src: string;
  width: number;
  height: number;
  strokes: MaskStroke[];
  onChange: (strokes: MaskStroke[]) => void;
}) {
  const [mode, setMode] = useState<MaskMode>('mark');
  const [size, setSize] = useState(48);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<MaskStroke | null>(null);
  const hintId = useId();

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => {
      setFrame({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fit =
    frame.width > 0 && width > 0 && height > 0
      ? Math.min((frame.width - 2 * GUTTER) / width, (frame.height - 2 * GUTTER) / height)
      : 0;
  const shown = { width: width * fit, height: height * fit };

  /** The marked area, opaque on the canvas; the canvas itself is half see-through. */
  const paint = useCallback(
    (extra: MaskStroke | null = null) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || fit <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * fit * ratio);
      canvas.height = Math.round(height * fit * ratio);
      ctx.setTransform(ratio * fit, 0, 0, ratio * fit, 0, 0);
      const colour = getComputedStyle(canvas).getPropertyValue('--danger').trim() || 'red';
      drawStrokes(ctx, extra ? [...strokes, extra] : strokes, {
        mark: { colour },
        unmark: { colour, composite: 'destination-out' },
      });
    },
    [strokes, fit, width, height],
  );

  useEffect(() => {
    paint();
  }, [paint]);

  const toImage = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    return [
      Math.round(Math.min(width, Math.max(0, x))),
      Math.round(Math.min(height, Math.max(0, y))),
    ];
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || fit <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    live.current = {
      mode,
      radius: Math.max(1, Math.round(size / 2 / fit)),
      points: [toImage(event)],
    };
    paint(live.current);
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = live.current;
    if (!stroke) return;
    if (addPoint(stroke, toImage(event))) paint(stroke);
  };
  const onPointerEnd = () => {
    const stroke = live.current;
    live.current = null;
    if (stroke) onChange([...strokes, stroke]);
  };

  const marked = strokes.filter((stroke) => stroke.mode === 'mark').length;
  return (
    <div className="absolute inset-0 flex flex-col bg-surface">
      <div
        role="toolbar"
        aria-label="Mask brush"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-bg px-4 py-2.5"
      >
        <SegmentedControl
          label="Brush"
          options={MODES}
          value={mode}
          onChange={(value) => {
            setMode(value === 'unmark' ? 'unmark' : 'mark');
          }}
        />
        <label className="flex items-center gap-2.5 text-14 text-text-muted">
          Size
          <Slider
            min={8}
            max={160}
            step={4}
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
            }}
            className="w-28"
          />
          <span className="w-12 font-mono text-12.5 text-text">{size} px</span>
        </label>
        <span className="ml-auto flex">
          <IconButton
            label="Undo stroke"
            disabled={strokes.length === 0}
            onClick={() => {
              onChange(strokes.slice(0, -1));
            }}
          >
            <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Clear the mask"
            disabled={strokes.length === 0}
            onClick={() => {
              onChange([]);
            }}
          >
            <Eraser size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden">
        {fit > 0 && (
          <div
            className="absolute"
            style={{
              left: (frame.width - shown.width) / 2,
              top: (frame.height - shown.height) / 2,
              width: shown.width,
              height: shown.height,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={src} alt="" className="absolute inset-0 size-full" />
            <canvas
              ref={canvasRef}
              aria-label={`Mask brush: drag to ${mode} what to remove`}
              aria-describedby={hintId}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              className="absolute inset-0 size-full cursor-crosshair touch-none opacity-55"
            />
          </div>
        )}
        <span id={hintId} className="sr-only">
          Mark paints over what to remove; Unmark takes parts of the marked area back. Brush a
          little past the object&apos;s edges and over its shadow.
        </span>
        <MediaTag className="left-3.5">
          {marked === 0
            ? 'Brush over what to remove'
            : strokes.length === 1
              ? '1 stroke'
              : `${String(strokes.length)} strokes`}
        </MediaTag>
      </div>
    </div>
  );
}

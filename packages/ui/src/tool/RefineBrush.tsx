'use client';

import { Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';

import { Button } from '../primitives/Button';
import { drawStrokes } from './brush';
import { IconButton } from './CanvasEditor';
import { Slider } from '../primitives/fields';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { MediaTag } from './BeforeAfter';

/** A brush stroke in image px (the engines' Stroke). */
export interface BrushStroke {
  mode: 'keep' | 'erase';
  radius: number;
  points: [number, number][];
}

const MODES = [
  { value: 'keep', label: 'Keep' },
  { value: 'erase', label: 'Erase' },
];

/**
 * The Refine brush of CanvasEditor (tools/photo.md → P07): paint over the
 * result to keep parts the model dropped or erase parts it kept. The original
 * shows faintly under the cut-out so dropped parts can be found. Strokes are
 * in image px and applied by the engine to the full-size mask.
 */
export function RefineBrush({
  result,
  original,
  width,
  height,
  strokes: initial,
  onApply,
  onCancel,
}: {
  result: string;
  original: string;
  width: number;
  height: number;
  strokes: BrushStroke[];
  onApply: (strokes: BrushStroke[]) => void;
  onCancel: () => void;
}) {
  const [strokes, setStrokes] = useState(initial);
  const [mode, setMode] = useState<BrushStroke['mode']>('erase');
  const [size, setSize] = useState(40);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<BrushStroke | null>(null);
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

  const gutter = 24;
  const fit =
    frame.width > 0
      ? Math.min((frame.width - 2 * gutter) / width, (frame.height - 2 * gutter) / height)
      : 0;
  const shown = { width: width * fit, height: height * fit };

  /** Paints the strokes as tints: lime where kept, red where erased. */
  const paint = useCallback(
    (extra: BrushStroke | null = null) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || fit <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * fit * ratio);
      canvas.height = Math.round(height * fit * ratio);
      ctx.setTransform(ratio * fit, 0, 0, ratio * fit, 0, 0);
      const styles = getComputedStyle(canvas);
      const colour = {
        keep: styles.getPropertyValue('--media-accent').trim() || 'white',
        erase: styles.getPropertyValue('--danger').trim() || 'red',
      };
      drawStrokes(ctx, extra ? [...strokes, extra] : strokes, {
        keep: { colour: colour.keep, alpha: 0.45 },
        erase: { colour: colour.erase, alpha: 0.45 },
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
    if (!live.current) return;
    live.current.points.push(toImage(event));
    paint(live.current);
  };
  const onPointerEnd = () => {
    const stroke = live.current;
    live.current = null;
    if (stroke) setStrokes((current) => [...current, stroke]);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-surface">
      <div
        role="toolbar"
        aria-label="Refine brush"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-bg px-4 py-2.5"
      >
        <SegmentedControl
          label="Brush"
          options={MODES}
          value={mode}
          onChange={(value) => {
            setMode(value === 'keep' ? 'keep' : 'erase');
          }}
        />
        <label className="flex items-center gap-2.5 text-14 text-text-muted">
          Size
          <Slider
            min={8}
            max={120}
            step={2}
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
            }}
            className="w-28"
          />
          <span className="w-12 font-mono text-12.5 text-text">{size} px</span>
        </label>
        <IconButton
          label="Undo stroke"
          disabled={strokes.length === 0}
          onClick={() => {
            setStrokes((current) => current.slice(0, -1));
          }}
        >
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onApply(strokes);
            }}
          >
            Apply
          </Button>
        </span>
      </div>
      <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden">
        {fit > 0 && (
          <div
            className="checkerboard absolute"
            style={{
              left: (frame.width - shown.width) / 2,
              top: (frame.height - shown.height) / 2,
              width: shown.width,
              height: shown.height,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={original} alt="" className="absolute inset-0 size-full opacity-30" />
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={result} alt="" className="absolute inset-0 size-full" />
            <canvas
              ref={canvasRef}
              aria-label={`Refine brush: drag to ${mode} parts of the image`}
              aria-describedby={hintId}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              className="absolute inset-0 size-full cursor-crosshair touch-none"
            />
          </div>
        )}
        <span id={hintId} className="sr-only">
          Keep paints the subject back in, Erase removes more background. Select Apply to update the
          result.
        </span>
        <MediaTag className="left-3.5">
          {strokes.length === 1 ? '1 stroke' : `${String(strokes.length)} strokes`}
        </MediaTag>
      </div>
    </div>
  );
}

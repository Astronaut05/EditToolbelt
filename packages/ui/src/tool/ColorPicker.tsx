'use client';

import { describeColor, sampleColor, type PickedColor } from '@etb/engines';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { CopyButton } from '../primitives/CopyButton';

interface Point {
  x: number;
  y: number;
}

/** Most picks kept in the history. */
const HISTORY = 24;

/** Three copy buttons: HEX, RGB, HSL. */
function Copies({ color, compact = false }: { color: PickedColor; compact?: boolean }) {
  return (
    <div className="-mx-1.5 flex">
      {(
        [
          ['HEX', color.hex.toUpperCase()],
          ['RGB', color.rgb],
          ['HSL', color.hsl],
        ] as const
      ).map(([name, text]) => (
        <CopyButton key={name} text={text} label={`Copy ${color.hex} as ${name}`} compact={compact}>
          {name}
        </CopyButton>
      ))}
    </div>
  );
}

/**
 * C02's workspace: the image, a loupe and a readout. Pointing reads the
 * colour under the pointer; a click or tap picks it into the history. From
 * the keyboard, arrows move the crosshair one pixel (Shift: ten) and Enter
 * or Space picks. Pixels are read as stored in the file (no colour-space
 * conversion), so a pick is the file's exact value.
 */
export function ColorPicker({
  src,
  sample,
  zoom,
  picked,
  onPick,
}: {
  src: string;
  /** 1, 3 or 5: the side of the block averaged. */
  sample: number;
  /** Loupe magnification. */
  zoom: number;
  /** Picked HEX colours, newest first. */
  picked: string[];
  onPick: (hexes: string[]) => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [failed, setFailed] = useState(false);
  const [reader, setReader] = useState<OffscreenCanvasRenderingContext2D | null>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const run = { live: true };
    let loaded: ImageBitmap | null = null;
    void (async () => {
      try {
        // Through an image element: the page's CSP lets images, not fetch, read blob: URLs.
        const element = new Image();
        element.src = src;
        await element.decode();
        loaded = await createImageBitmap(element, {
          imageOrientation: 'from-image',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        if (!run.live) {
          loaded.close();
          return;
        }
        const canvas = new OffscreenCanvas(loaded.width, loaded.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx?.drawImage(loaded, 0, 0);
        setReader(ctx);
        setBitmap(loaded);
        setPoint({ x: Math.floor(loaded.width / 2), y: Math.floor(loaded.height / 2) });
      } catch {
        if (run.live) setFailed(true);
      }
    })();
    return () => {
      run.live = false;
      loaded?.close();
    };
  }, [src]);

  const colorAt = (p: Point): PickedColor | null => {
    const ctx = reader;
    if (!ctx || !bitmap) return null;
    const r = Math.floor(sample / 2);
    const x0 = Math.max(0, p.x - r);
    const y0 = Math.max(0, p.y - r);
    const x1 = Math.min(bitmap.width, p.x + r + 1);
    const y1 = Math.min(bitmap.height, p.y + r + 1);
    return sampleColor(ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data);
  };
  const current = point ? colorAt(point) : null;

  // The loupe: the pixels around the point, each drawn as a square, the sample outlined.
  useEffect(() => {
    const canvas = loupe.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !bitmap || !point) return;
    const cells = Math.floor(canvas.width / zoom) | 1;
    const half = Math.floor(cells / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const offset = (canvas.width - cells * zoom) / 2;
    ctx.drawImage(
      bitmap,
      point.x - half,
      point.y - half,
      cells,
      cells,
      offset,
      offset,
      cells * zoom,
      cells * zoom,
    );
    const r = Math.floor(sample / 2);
    const at = offset + (half - r) * zoom;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(at - 1, at - 1, sample * zoom + 2, sample * zoom + 2);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(at - 3, at - 3, sample * zoom + 6, sample * zoom + 6);
  }, [bitmap, point, sample, zoom]);

  function pointAt(event: ReactPointerEvent<HTMLElement>): Point | null {
    const box = image.current?.getBoundingClientRect();
    if (!box || !bitmap || box.width === 0) return null;
    const x = Math.floor(((event.clientX - box.left) / box.width) * bitmap.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * bitmap.height);
    return {
      x: Math.min(bitmap.width - 1, Math.max(0, x)),
      y: Math.min(bitmap.height - 1, Math.max(0, y)),
    };
  }

  function pick(p: Point) {
    const c = colorAt(p);
    if (!c) return;
    onPick([c.hex, ...picked.filter((hex) => hex !== c.hex)].slice(0, HISTORY));
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!bitmap || !point) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: point.x - step, y: point.y },
      ArrowRight: { x: point.x + step, y: point.y },
      ArrowUp: { x: point.x, y: point.y - step },
      ArrowDown: { x: point.x, y: point.y + step },
    };
    const next = moves[event.key];
    if (next) {
      event.preventDefault();
      setPoint({
        x: Math.min(bitmap.width - 1, Math.max(0, next.x)),
        y: Math.min(bitmap.height - 1, Math.max(0, next.y)),
      });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(point);
    }
  }

  if (failed) {
    return (
      <p className="px-4 py-6 text-14 text-text-muted lg:px-10">
        This image couldn’t be read for picking. Try a JPG or PNG.
      </p>
    );
  }

  const marker =
    bitmap && point
      ? {
          left: `${String(((point.x + 0.5) / bitmap.width) * 100)}%`,
          top: `${String(((point.y + 0.5) / bitmap.height) * 100)}%`,
        }
      : null;

  return (
    <div className="flex flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:px-10 lg:pt-8.5">
      <div
        tabIndex={0}
        role="application"
        aria-label="Image: point or tap to read a color, click to pick it. Arrow keys move one pixel, Shift and an arrow ten, Enter picks."
        onKeyDown={onKey}
        className="relative min-w-0 flex-1 self-start outline-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        <img
          ref={image}
          src={src}
          alt=""
          draggable={false}
          onPointerMove={(event) => {
            const p = pointAt(event);
            if (p) setPoint(p);
          }}
          onPointerDown={(event) => {
            const p = pointAt(event);
            if (!p) return;
            setPoint(p);
            pick(p);
          }}
          className="block max-h-[70dvh] max-w-full cursor-crosshair touch-none border border-border select-none"
        />
        {marker && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_black]"
            style={marker}
          />
        )}
      </div>
      <div className="flex w-full flex-col gap-4 lg:w-72 lg:flex-none">
        <canvas
          ref={loupe}
          width={132}
          height={132}
          aria-hidden="true"
          className="size-33 self-start border border-border [image-rendering:pixelated]"
        />
        <div aria-live="polite">
          {current && point && (
            <>
              <p className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-8 flex-none rounded-control border border-border"
                  style={{ background: current.hex }}
                />
                <span className="font-mono text-15 font-medium text-text">
                  {current.hex.toUpperCase()}
                </span>
              </p>
              <p className="mt-1 font-mono text-12 text-text-muted">
                x {point.x} · y {point.y} px ·{' '}
                {sample === 1 ? '1 px' : `${String(sample)} × ${String(sample)} average`}
              </p>
              <Copies color={current} />
            </>
          )}
        </div>
        <div>
          <p className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            Picked
          </p>
          {picked.length === 0 ? (
            <p className="mt-2 text-14 text-text-muted">Click or tap the image to pick a color.</p>
          ) : (
            <ul aria-label="Picked colors" className="mt-2 flex flex-col">
              {picked.map((hex) => {
                const parsed = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
                const c = parsed
                  ? describeColor(
                      parseInt(parsed[1] ?? '0', 16),
                      parseInt(parsed[2] ?? '0', 16),
                      parseInt(parsed[3] ?? '0', 16),
                    )
                  : null;
                return (
                  c && (
                    <li key={hex} className="flex items-center gap-2 border-b border-border py-1">
                      <span
                        aria-hidden="true"
                        className="size-5 flex-none rounded-control border border-border"
                        style={{ background: hex }}
                      />
                      <span className="min-w-0 flex-1 font-mono text-13">{hex.toUpperCase()}</span>
                      <Copies color={c} compact />
                    </li>
                  )
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

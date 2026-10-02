'use client';

import {
  drawTextLayers,
  hitsLayer,
  layerFrame,
  loadTextFont,
  measureText,
  snapCentre,
  type Size,
  type TextLayer,
  type Upright,
} from '@etb/engines';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { baseOf, boxMapping, imagePerScreen, type Nudge, type ToImage } from './mapping';

/** Snapping reach to the image's middle lines, in screen pixels. */
const SNAP_PX = 8;

/** A new layer where the image was clicked, sized for the image: white with a shadow reads on most photos. */
export function newTextLayer(
  natural: Size,
  x = natural.width / 2,
  y = natural.height / 2,
  upright?: Upright,
): TextLayer {
  const base = baseOf(upright);
  return {
    ...(base && { base }),
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: 'Your text',
    font: 'onest',
    bold: true,
    size: Math.max(12, Math.round(Math.min(natural.width, natural.height) / 10)),
    color: '#ffffff',
    align: 'center',
    x: Math.round(x),
    y: Math.round(y),
    rotation: 0,
    stroke: 0,
    strokeColor: '#000000',
    shadow: true,
    box: false,
    boxColor: '#000000',
    boxOpacity: 0.5,
  };
}

/**
 * The text over the image: drawn on a canvas at the screen's scale with the
 * export's own renderer, a frame around the chosen layer to drag it (it snaps
 * to the image's middle lines, which show while it does), and arrow keys to
 * nudge it. Clicking a layer chooses it; clicking elsewhere adds one there.
 */
export function TextLayers({
  natural,
  layers,
  selected,
  onSelect,
  onLayers,
  toImage,
  upright,
  nudge,
}: {
  natural: Size;
  layers: readonly TextLayer[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onLayers: (layers: TextLayer[], transient?: boolean) => void;
  /** P01: the editor's pointer mapping, its turns and flips undone. */
  toImage?: ToImage;
  /** P01: the turn that keeps a new layer upright in the editor's frame. */
  upright?: Upright;
  /** P01: arrow-key moves taken into the image's own pixels. */
  nudge?: Nudge;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(0);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [frames, setFrames] = useState<Record<string, { width: number; height: number }>>({});

  // Fonts load as they're picked; the text is drawn again once they're in.
  const fontKey = layers
    .map((layer) => `${layer.font}:${String(layer.bold)}:${layer.text}`)
    .join('|');
  useEffect(() => {
    let live = true;
    void Promise.all(layers.map((layer) => loadTextFont(layer))).then(() => {
      if (live) setFontsReady((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // The key stands for what changes the fonts a layer needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(element.clientWidth * ratio));
      const height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      drawTextLayers(ctx, layers, width / natural.width);
      const next: Record<string, { width: number; height: number }> = {};
      for (const layer of layers) next[layer.id] = layerFrame(measureText(ctx, layer), layer);
      setFrames(next);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [layers, natural, fontsReady]);

  /** Screen pixels per image pixel, and a pointer's place in image pixels. */
  const geometry = () => {
    const map = toImage ?? boxMapping(canvas.current, natural);
    return {
      scale: 1 / imagePerScreen(map),
      at: (event: { clientX: number; clientY: number }) => map(event.clientX, event.clientY),
    };
  };

  const blockOf = (layer: TextLayer) => {
    const ctx = canvas.current?.getContext('2d');
    return ctx ? measureText(ctx, layer) : { width: 0, height: 0, lines: [] };
  };

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const { scale, at } = geometry();
    const [px, py] = at(event);
    // Topmost first: the last layer is drawn last.
    const hit = [...layers].reverse().find((layer) => hitsLayer(blockOf(layer), layer, px, py));
    if (!hit) {
      const added = newTextLayer(natural, px, py, upright);
      onLayers([...layers, added]);
      onSelect(added.id);
      return;
    }
    onSelect(hit.id);
    const pointer = event.pointerId;
    const start = { x: event.clientX, y: event.clientY, layer: hit };
    let moved = false;
    let latest: TextLayer[] = [...layers];
    const follow = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
      const [qx, qy] = at(e);
      const dx = qx - px;
      const dy = qy - py;
      moved = true;
      const snapped = snapCentre(
        start.layer.x + dx,
        start.layer.y + dy,
        natural.width,
        natural.height,
        SNAP_PX / scale,
      );
      setGuides({ x: snapped.snappedX, y: snapped.snappedY });
      latest = layers.map((layer) =>
        layer.id === hit.id
          ? { ...layer, x: Math.round(snapped.x), y: Math.round(snapped.y) }
          : layer,
      );
      onLayers(latest, true);
    };
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setGuides({ x: false, y: false });
      if (moved) onLayers(latest);
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const layer = layers.find((candidate) => candidate.id === selected);
    if (!layer) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const key = moves[event.key];
    if (key) {
      event.preventDefault();
      const move = nudge ? nudge(key[0], key[1]) : key;
      onLayers(
        layers.map((candidate) =>
          candidate.id === layer.id
            ? {
                ...candidate,
                x: Math.round(candidate.x + move[0]),
                y: Math.round(candidate.y + move[1]),
              }
            : candidate,
        ),
      );
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onLayers(layers.filter((candidate) => candidate.id !== layer.id));
      onSelect(null);
    }
  }

  const chosen = layers.find((layer) => layer.id === selected);
  const frame = chosen && frames[chosen.id];
  return (
    <>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Text on the image, ${String(layers.length)} ${layers.length === 1 ? 'layer' : 'layers'}`}
        onPointerDown={onPointerDown}
        className="absolute inset-0 size-full cursor-text touch-none"
      />
      {guides.x && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent"
        />
      )}
      {guides.y && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent"
        />
      )}
      {chosen && frame && (
        <div
          role="group"
          tabIndex={0}
          aria-label={`Text “${chosen.text.split('\n')[0] ?? ''}”, at ${String(chosen.x)}, ${String(chosen.y)}`}
          aria-description="Drag to move. Arrow keys move it 1 px, Shift 10 px. Delete removes it."
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          className="absolute cursor-move touch-none border border-dashed border-media-text shadow-[0_0_0_1px_var(--media-scrim)] outline-offset-4"
          style={{
            left: `${String((chosen.x / natural.width) * 100)}%`,
            top: `${String((chosen.y / natural.height) * 100)}%`,
            width: `${String((frame.width / natural.width) * 100)}%`,
            height: `${String((frame.height / natural.height) * 100)}%`,
            transform: `translate(-50%, -50%)${chosen.base ? ` rotate(${String(chosen.base.rotation)}deg)${chosen.base.mirror ? ' scaleX(-1)' : ''}` : ''} rotate(${String(chosen.rotation)}deg)`,
          }}
        />
      )}
    </>
  );
}

'use client';

import { Minus, Plus } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../cn';
import { formatTimecode, parseTimecode } from './format';

export interface TimelineRange {
  start: number;
  end: number;
}

/** Deterministic bar heights for a waveform stand-in (no audio decoded in M1). */
function bars(count: number, seed: number): number[] {
  let x = seed;
  return Array.from({ length: count }, (_, i) => {
    x = (x * 16807) % 2147483647;
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(i / 9));
    return Math.max(0.08, (x / 2147483647) * envelope);
  });
}

/**
 * The shared media timeline shell (docs/03 → Timeline): waveform (audio) or
 * thumbnail strip (video), playhead, in/out handles, zoom and frame-stepping
 * keys. Keys: ←/→ one frame (Shift: one second), I and O set in/out at the
 * playhead, Home/End jump. In and Out can also be typed ("1:02.5"). The page
 * passes the video's frames as thumbnails and follows the playhead (onSeek).
 */
export function Timeline({
  durationSec,
  fps = 30,
  kind = 'audio',
  value,
  onChange,
  thumbnails,
  onSeek,
  className,
}: {
  durationSec: number;
  fps?: number;
  kind?: 'audio' | 'video';
  value: TimelineRange;
  onChange: (range: TimelineRange) => void;
  /** Frames across the clip, left to right (object URLs). */
  thumbnails?: string[];
  /** The time the user is looking at: the playhead, or the handle being dragged. */
  onSeek?: (time: number) => void;
  className?: string;
}) {
  const [playhead, setPlayhead] = useState(value.start);
  const [zoom, setZoom] = useState(1);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | 'playhead' | null>(null);
  const waveform = useMemo(() => bars(160, 42), []);
  const frame = 1 / fps;
  const pct = (t: number) => `${String((t / durationSec) * 100)}%`;
  const clamp = (t: number) => Math.min(durationSec, Math.max(0, Math.round(t / frame) * frame));

  function timeAt(clientX: number): number {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp(((clientX - rect.left) / rect.width) * durationSec);
  }

  function onPointerDown(
    event: PointerEvent<HTMLDivElement>,
    target: 'start' | 'end' | 'playhead',
  ) {
    event.stopPropagation();
    dragging.current = target;
    track.current?.setPointerCapture(event.pointerId);
    move(event.clientX);
  }

  function seek(t: number) {
    setPlayhead(t);
    onSeek?.(t);
  }

  function setIn(t: number) {
    const start = clamp(Math.min(t, value.end - frame));
    onChange({ start, end: value.end });
    onSeek?.(start);
  }

  function setOut(t: number) {
    const end = clamp(Math.max(t, value.start + frame));
    onChange({ start: value.start, end });
    onSeek?.(end);
  }

  function move(clientX: number) {
    const t = timeAt(clientX);
    if (dragging.current === 'start') setIn(t);
    else if (dragging.current === 'end') setOut(t);
    else if (dragging.current === 'playhead') seek(t);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 1 : frame;
    const key = event.key.toLowerCase();
    if (key === 'arrowleft') seek(clamp(playhead - step));
    else if (key === 'arrowright') seek(clamp(playhead + step));
    else if (key === 'home') seek(0);
    else if (key === 'end') seek(durationSec);
    else if (key === 'i') setIn(playhead);
    else if (key === 'o') setOut(playhead);
    else return;
    event.preventDefault();
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-12 uppercase tracking-meta text-text-muted">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TimeField label="In" value={value.start} onCommit={setIn} />
          <TimeField label="Out" value={value.end} onCommit={setOut} />
          <b className="font-medium text-text">{(value.end - value.start).toFixed(2)} s</b>
        </span>
        <span className="flex items-center">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => {
              setZoom(zoom / 2);
            }}
            className="inline-flex size-11 items-center justify-center hover:text-text disabled:opacity-38"
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <output aria-label="Timeline zoom" className="w-8 text-center">
            {zoom}×
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= 16}
            onClick={() => {
              setZoom(zoom * 2);
            }}
            className="inline-flex size-11 items-center justify-center hover:text-text disabled:opacity-38"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <div
          ref={track}
          role="group"
          tabIndex={0}
          aria-label={`Timeline. Playhead ${formatTimecode(playhead)}. Arrow keys move by frame, I and O set in and out.`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            onPointerDown(event, 'playhead');
          }}
          onPointerMove={(event) => {
            if (dragging.current) move(event.clientX);
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
          className="relative h-24 touch-none bg-surface select-none"
          style={{ width: `${String(zoom * 100)}%` }}
        >
          {kind === 'audio' ? (
            <div aria-hidden="true" className="absolute inset-0 flex items-center gap-px px-px">
              {waveform.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 bg-text-muted/60"
                  style={{ height: `${String(h * 90)}%` }}
                />
              ))}
            </div>
          ) : thumbnails && thumbnails.length > 0 ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex overflow-hidden bg-media-scrim"
            >
              {thumbnails.map((src, i) =>
                src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- frames decoded in the page
                  <img
                    key={i}
                    src={src}
                    alt=""
                    draggable={false}
                    className="h-full min-w-0 flex-1 border-r border-media-scrim object-cover"
                  />
                ) : (
                  <span key={i} className="h-full flex-1 border-r border-media-scrim" />
                ),
              )}
            </div>
          ) : (
            <div aria-hidden="true" className="absolute inset-0 flex">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className="flex flex-1 items-end border-r border-bg bg-border/60 p-1 font-mono text-11 text-text-muted"
                >
                  {formatTimecode((durationSec / 10) * i).slice(3, 8)}
                </span>
              ))}
            </div>
          )}
          {/* Outside the selection is dimmed. */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-bg/70"
            style={{ width: pct(value.start) }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 bg-bg/70"
            style={{ left: pct(value.end) }}
          />
          {(['start', 'end'] as const).map((edge) => (
            <div
              key={edge}
              aria-hidden="true"
              onPointerDown={(event) => {
                onPointerDown(event, edge);
              }}
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: pct(edge === 'start' ? value.start : value.end) }}
            >
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-text" />
              <span className="absolute top-0 left-1/2 h-4 w-3 -translate-x-1/2 bg-text" />
            </div>
          ))}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-accent"
            style={{ left: pct(playhead) }}
          />
        </div>
      </div>
      <p className="font-mono text-12 uppercase tracking-meta text-text-muted">
        Playhead <b className="font-medium text-text">{formatTimecode(playhead)}</b> · {fps} fps
      </p>
    </div>
  );
}

/** A typed time: kept as text while typing, applied on Enter or leaving the field. */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const seconds = draft === null ? null : parseTimecode(draft);
    if (seconds !== null) onCommit(seconds);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5">
      {label}
      <input
        aria-label={`${label} point`}
        inputMode="decimal"
        spellCheck={false}
        value={draft ?? formatTimecode(value)}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
        className="h-9 w-32 rounded-control border border-border bg-bg px-2 text-right font-mono text-12.5 text-text normal-case hover:border-text focus-visible:border-text"
      />
    </label>
  );
}

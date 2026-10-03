'use client';

import { addRange, clampRange, invertRanges } from '@etb/core/ranges';
import { Minus, Plus, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { cn } from '../cn';
import { formatTimecode, parseTimecode } from './format';

export interface TimelineRange {
  start: number;
  end: number;
}

/** Deterministic bar heights for a waveform stand-in, until the audio is read. */
function bars(count: number, seed: number): number[] {
  let x = seed;
  return Array.from({ length: count }, (_, i) => {
    x = (x * 16807) % 2147483647;
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(i / 9));
    return Math.max(0.08, (x / 2147483647) * envelope);
  });
}

/** A timecode without the hours when there are none: "01:02.500". */
function short(seconds: number): string {
  const tc = formatTimecode(seconds);
  return tc.startsWith('00:') ? tc.slice(3) : tc;
}

/**
 * The shared media timeline shell (docs/03 → Timeline): waveform (audio) or
 * thumbnail strip (video), playhead, in/out handles, zoom and frame-stepping
 * keys. Keys: ←/→ one frame (Shift: one second), I and O set in/out at the
 * playhead, Home/End jump. In and Out can also be typed ("1:02.5"). The page
 * passes the video's frames as thumbnails and follows the playhead (onSeek).
 *
 * With `ranges` (V01, A02) it holds several ranges: the handles, In/Out and
 * the I/O keys edit the selected one, ranges never overlap, and a row of
 * buttons selects, adds and removes them.
 */
export function Timeline({
  durationSec,
  fps: fpsProp,
  kind = 'audio',
  value,
  onChange,
  thumbnails,
  peaks,
  onSeek,
  ranges,
  active = 0,
  onRangesChange,
  className,
}: {
  durationSec: number;
  fps?: number;
  kind?: 'audio' | 'video';
  value: TimelineRange;
  onChange: (range: TimelineRange) => void;
  /** Several ranges; `value` is then the selected one, `ranges[active]`. */
  ranges?: TimelineRange[];
  active?: number;
  onRangesChange?: (ranges: TimelineRange[], active: number) => void;
  /** Frames across the clip, left to right (object URLs). */
  thumbnails?: string[];
  /** The audio's loudness across the clip, 0 to 1 (the real waveform). */
  peaks?: number[];
  /** The time the user is looking at: the playhead, or the handle being dragged. */
  onSeek?: (time: number) => void;
  className?: string;
}) {
  const [playhead, setPlayhead] = useState(value.start);
  const [zoom, setZoom] = useState(1);
  // What the keys did, said once they stop (a held arrow would queue a time per step).
  const [spoken, setSpoken] = useState('');
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (speakTimer.current) clearTimeout(speakTimer.current);
    },
    [],
  );
  const playheadId = useId();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | 'playhead' | null>(null);
  const standIn = useMemo(() => bars(160, 42), []);
  const waveform = peaks && peaks.length > 0 ? peaks : standIn;
  // Audio steps by the millisecond, video by the frame.
  const fps = fpsProp ?? (kind === 'audio' ? 1000 : 30);
  const frame = 1 / fps;
  const stepName = kind === 'audio' ? `${String(Math.round(1000 / fps))} ms` : 'frame';
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

  const multi = ranges !== undefined && onRangesChange !== undefined;

  /** The selected range, kept clear of its neighbours when there are several; what was set. */
  function update(next: TimelineRange): TimelineRange {
    if (!multi) {
      onChange(next);
      return next;
    }
    const kept = clampRange(ranges, active, next, durationSec, frame);
    onRangesChange(
      ranges.map((r, i) => (i === active ? kept : r)),
      active,
    );
    return kept;
  }

  function setIn(t: number): number {
    const start = clamp(Math.min(t, value.end - frame));
    const set = update({ start, end: value.end }).start;
    // The playhead follows the edit, so the frame shown is the one cut at.
    seek(start);
    return set;
  }

  function setOut(t: number): number {
    const end = clamp(Math.max(t, value.start + frame));
    const set = update({ start: value.start, end }).end;
    seek(end);
    return set;
  }

  function select(index: number) {
    if (!multi) return;
    onRangesChange(ranges, index);
    const r = ranges[index];
    if (r) seek(r.start);
  }

  function add() {
    if (!multi) return;
    const made = addRange(ranges, playhead, durationSec, Math.max(1, durationSec / 20), frame * 2);
    if (!made) return;
    onRangesChange(made.ranges, made.active);
    const r = made.ranges[made.active];
    if (r) seek(r.start);
  }

  function remove() {
    if (!multi || ranges.length < 2) return;
    const next = ranges.filter((_, i) => i !== active);
    onRangesChange(next, Math.max(0, active - 1));
  }

  const all = multi ? ranges : [value];
  const gaps = invertRanges(all, durationSec);
  const total = all.reduce((sum, r) => sum + (r.end - r.start), 0);
  const roomLeft = gaps.some((g) => g.end - g.start >= frame * 2);

  function move(clientX: number) {
    const t = timeAt(clientX);
    if (dragging.current === 'start') setIn(t);
    else if (dragging.current === 'end') setOut(t);
    else if (dragging.current === 'playhead') seek(t);
  }

  function speak(line: string) {
    if (speakTimer.current) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => {
      // The same time again (Home at the start) is still news.
      setSpoken((said) => (said === line ? `${line}\u00a0` : line));
    }, 300);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 1 : frame;
    const key = event.key.toLowerCase();
    const to =
      key === 'arrowleft'
        ? clamp(playhead - step)
        : key === 'arrowright'
          ? clamp(playhead + step)
          : key === 'home'
            ? 0
            : key === 'end'
              ? durationSec
              : null;
    let line: string;
    if (to !== null) {
      seek(to);
      line = `Playhead ${formatTimecode(to)}`;
    } else if (key === 'i') line = `In ${formatTimecode(setIn(playhead))}`;
    else if (key === 'o') line = `Out ${formatTimecode(setOut(playhead))}`;
    else return;
    event.preventDefault();
    speak(line);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-12 uppercase tracking-meta text-text-muted">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TimeField label="In" value={value.start} onCommit={setIn} />
          <TimeField label="Out" value={value.end} onCommit={setOut} />
          <b className="font-medium text-text">{(value.end - value.start).toFixed(2)} s</b>
          {multi && ranges.length > 1 && (
            <span>
              {ranges.length} ranges · {total.toFixed(2)} s
            </span>
          )}
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
          aria-label={`Timeline. Arrow keys move the playhead by ${stepName}, Shift by 1 s. I and O set in and out.`}
          aria-describedby={playheadId}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            if (multi) {
              const t = timeAt(event.clientX);
              const hit = ranges.findIndex((r) => t >= r.start && t <= r.end);
              if (hit >= 0 && hit !== active) onRangesChange(ranges, hit);
            }
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
                  style={{ height: `${String(Math.max(0.02, h) * 90)}%` }}
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
          {/* Outside the selection is dimmed; other ranges get an outline. */}
          {gaps.map((g) => (
            <div
              key={g.start}
              aria-hidden="true"
              className="absolute inset-y-0 bg-bg/70"
              style={{ left: pct(g.start), width: pct(g.end - g.start) }}
            />
          ))}
          {multi &&
            ranges.map((r, i) =>
              i === active ? null : (
                <div
                  key={r.start}
                  aria-hidden="true"
                  className="absolute inset-y-0 border-y-2 border-text-muted"
                  style={{ left: pct(r.start), width: pct(r.end - r.start) }}
                />
              ),
            )}
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
      {multi && (
        <div role="group" aria-label="Ranges" className="flex flex-wrap items-center gap-2">
          {ranges.map((r, i) => (
            <button
              key={r.start}
              type="button"
              aria-pressed={i === active}
              aria-label={`Range ${String(i + 1)}: ${short(r.start)} to ${short(r.end)}`}
              onClick={() => {
                select(i);
              }}
              className={cn(
                'min-h-11 rounded-control border px-3 font-mono text-12 tabular-nums',
                i === active
                  ? 'border-text text-text'
                  : 'border-border text-text-muted hover:border-text-muted hover:text-text',
              )}
            >
              {i + 1} · {short(r.start)}–{short(r.end)}
            </button>
          ))}
          <button
            type="button"
            onClick={add}
            disabled={!roomLeft}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-14 text-text hover:underline disabled:opacity-38"
          >
            <Plus size={16} aria-hidden="true" />
            Add range
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={ranges.length < 2}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-14 text-text hover:underline disabled:opacity-38"
          >
            <X size={16} aria-hidden="true" />
            Remove range
          </button>
        </div>
      )}
      <p id={playheadId} className="font-mono text-12 uppercase tracking-meta text-text-muted">
        Playhead <b className="font-medium text-text">{formatTimecode(playhead)}</b> ·{' '}
        {kind === 'audio' ? `${stepName} steps` : `${String(fps)} fps`}
      </p>
      <p role="status" className="sr-only">
        {spoken}
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
        className="h-9 w-32 rounded-control border border-border-field bg-bg px-2 text-right font-mono text-12.5 text-text normal-case hover:border-text focus-visible:border-text"
      />
    </label>
  );
}

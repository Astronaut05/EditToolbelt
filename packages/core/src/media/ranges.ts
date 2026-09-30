/**
 * Ranges on a media timeline (V01 Trim Video, A02 Trim Audio): the parts the
 * user selected, kept or removed, and how the kept parts join end to end.
 * Seconds throughout.
 */

export interface Span {
  start: number;
  end: number;
}

/** Shorter than this is no range at all: a stray click, or rounding. */
export const MIN_SPAN = 0.001;

/** In order, inside [0, duration], with overlapping or touching ranges merged. */
export function normalizeRanges(ranges: readonly Span[], duration: number): Span[] {
  const clipped = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(duration, Number.isFinite(r.start) ? r.start : 0)),
      end: Math.max(0, Math.min(duration, Number.isFinite(r.end) ? r.end : duration)),
    }))
    .filter((r) => r.end - r.start >= MIN_SPAN)
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const r of clipped) {
    const last = out.at(-1);
    if (last && r.start <= last.end + MIN_SPAN) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** What is left of [0, duration] once the ranges are taken out. */
export function invertRanges(ranges: readonly Span[], duration: number): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const r of normalizeRanges(ranges, duration)) {
    if (r.start - at >= MIN_SPAN) out.push({ start: at, end: r.start });
    at = r.end;
  }
  if (duration - at >= MIN_SPAN) out.push({ start: at, end: duration });
  return out;
}

/** The parts that make the result: the selection, or everything but it. */
export function keptSpans(
  ranges: readonly Span[],
  duration: number,
  mode: 'keep' | 'remove',
): Span[] {
  return mode === 'remove' ? invertRanges(ranges, duration) : normalizeRanges(ranges, duration);
}

export interface Layout {
  spans: Span[];
  /** Where each span starts in the result. */
  offsets: number[];
  /** Where two spans meet in the result. */
  joins: number[];
  length: number;
}

/** The kept spans end to end: where each lands, and where they meet. */
export function layoutSpans(spans: readonly Span[]): Layout {
  const offsets: number[] = [];
  let length = 0;
  for (const s of spans) {
    offsets.push(length);
    length += s.end - s.start;
  }
  return { spans: [...spans], offsets, joins: offsets.slice(1), length };
}

/**
 * A new range for the timeline's "Add range": at the playhead when it is in
 * a free stretch, else in the first free stretch after the last range, else
 * the first one anywhere. `length` long where there's room. Null when there
 * is no free stretch of at least `min` seconds.
 */
export function addRange(
  ranges: readonly Span[],
  playhead: number,
  duration: number,
  length: number,
  min = 0.1,
): { ranges: Span[]; active: number } | null {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const free = invertRanges(sorted, duration).filter((f) => f.end - f.start >= min);
  if (free.length === 0) return null;
  const inside = free.find((f) => playhead >= f.start && playhead <= f.end - min);
  const after = free.find((f) => f.start >= (sorted.at(-1)?.end ?? 0) - MIN_SPAN);
  const slot = inside ?? after ?? free[0];
  if (!slot) return null;
  const start = inside ? playhead : slot.start;
  const added = { start, end: Math.min(slot.end, start + length) };
  const next = [...sorted, added].sort((a, b) => a.start - b.start);
  return { ranges: next, active: next.indexOf(added) };
}

/**
 * Keeps the range at `index` between its neighbours, so ranges never
 * overlap: In no earlier than the previous range's Out, Out no later than the
 * next range's In, and at least `min` long.
 */
export function clampRange(
  ranges: readonly Span[],
  index: number,
  next: Span,
  duration: number,
  min: number,
): Span {
  const lo = ranges[index - 1]?.end ?? 0;
  const hi = ranges[index + 1]?.start ?? duration;
  const start = Math.max(lo, Math.min(next.start, hi - min));
  const end = Math.min(hi, Math.max(next.end, start + min));
  return { start, end };
}

/**
 * Subtitle timestamps. Reading is tolerant ("1:02:03,4", "02:03.456",
 * "0:01:02.03"); writing is strict per format.
 */

/**
 * "01:02:03,456", "01:02:03.456", "02:03.456" (VTT without hours),
 * "0:01:02.03" (ASS centiseconds) → milliseconds, or null.
 */
export function parseTime(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  const [, h = '0', m = '0', s = '0', fraction = ''] = match;
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes > 59 || seconds > 59) return null;
  // The fraction is a decimal: ".5" is 500 ms, ".05" 50 ms, ".005" 5 ms.
  const ms = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
  return ((Number(h) * 60 + minutes) * 60 + seconds) * 1000 + ms;
}

function parts(ms: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(ms));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor((total % 3_600_000) / 60_000),
    s: Math.floor((total % 60_000) / 1000),
    ms: total % 1000,
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** SRT: 00:01:02,345 */
export function formatSrtTime(ms: number): string {
  const t = parts(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)},${pad(t.ms, 3)}`;
}

/** WebVTT: 00:01:02.345 (hours always written, which every player accepts). */
export function formatVttTime(ms: number): string {
  const t = parts(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}.${pad(t.ms, 3)}`;
}

/** SBV (YouTube): 0:01:02.345 */
export function formatSbvTime(ms: number): string {
  const t = parts(ms);
  return `${String(t.h)}:${pad(t.m)}:${pad(t.s)}.${pad(t.ms, 3)}`;
}

/** ASS/SSA: 0:01:02.35, rounded to centiseconds. */
export function formatAssTime(ms: number): string {
  const t = parts(Math.round(ms / 10) * 10);
  return `${String(t.h)}:${pad(t.m)}:${pad(t.s)}.${pad(Math.round(t.ms / 10))}`;
}

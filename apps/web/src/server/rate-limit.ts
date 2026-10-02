/**
 * Fixed-window counters per key, in this process, with the `RateLimit-*`
 * headers docs/06 asks for on every answer. Enough for one web server;
 * Cloudflare's edge limits sit in front of it from Go public on (docs/01).
 *
 * The map is bounded: expired windows are swept every few hundred calls, and
 * past MAX_WINDOWS the oldest windows go first, so a flood of new keys
 * (addresses, guessed keys) can't grow it without end.
 */
import { ApiError } from './problem';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
/** Most windows kept at once; far above one server's real callers. */
export const MAX_WINDOWS = 50_000;
/** Expired windows are swept once every this many calls. */
const SWEEP_EVERY = 500;
let calls = 0;

function sweep(now: number): void {
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
  // Still too many live ones: drop the oldest (a Map keeps insertion order),
  // down to 90% so a flood doesn't sweep on every call.
  const keep = Math.floor(MAX_WINDOWS * 0.9);
  for (const key of windows.keys()) {
    if (windows.size <= keep) break;
    windows.delete(key);
  }
}

/** The key's window, a fresh one if it had none or it ran out. */
function windowFor(key: string, windowSec: number, now: number): Window {
  calls += 1;
  if (calls % SWEEP_EVERY === 0 || windows.size >= MAX_WINDOWS) sweep(now);
  let window = windows.get(key);
  if (!window || window.resetAt <= now) {
    // Deleted first, so a renewed window moves to the end of the map's order.
    windows.delete(key);
    window = { count: 0, resetAt: now + windowSec * 1000 };
    windows.set(key, window);
  }
  return window;
}

const secondsLeft = (window: Window, now: number): number =>
  Math.max(0, Math.ceil((window.resetAt - now) / 1000));

function headersOf(limit: number, count: number, reset: number): Record<string, string> {
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, limit - count)),
    'RateLimit-Reset': String(reset),
  };
}

function refusal(headers: Record<string, string>, reset: number): ApiError {
  return new ApiError(
    429,
    'RATE_LIMITED',
    'Too many requests',
    `Try again in ${String(reset)} s.`,
    {},
    { ...headers, 'Retry-After': String(reset) },
  );
}

/**
 * Counts one call against `key`. Returns the `RateLimit-*` headers and
 * whether the window is used up; never throws.
 */
export function countCall(
  key: string,
  limit: number,
  windowSec: number,
  now = Date.now(),
): { headers: Record<string, string>; exceeded: boolean; reset: number } {
  const window = windowFor(key, windowSec, now);
  window.count += 1;
  const reset = secondsLeft(window, now);
  return { headers: headersOf(limit, window.count, reset), exceeded: window.count > limit, reset };
}

/**
 * A fixed-window limit per key. Returns the `RateLimit-*` headers; throws
 * 429 RATE_LIMITED with `Retry-After` when the window is used up.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now = Date.now(),
): Record<string, string> {
  const counted = countCall(key, limit, windowSec, now);
  if (counted.exceeded) throw refusal(counted.headers, counted.reset);
  return counted.headers;
}

/**
 * Limits on failures (a wrong code), not on calls: `strike` counts one
 * failure in the key's window and answers how many there are now.
 */
export function strike(key: string, windowSec: number, now = Date.now()): number {
  const window = windowFor(key, windowSec, now);
  window.count += 1;
  return window.count;
}

/**
 * Once `limit` failures were struck in the key's window, every attempt is
 * refused until the window ends: answers the seconds left, 0 if not locked.
 */
export function lockoutLeft(key: string, limit: number, now = Date.now()): number {
  const window = windows.get(key);
  if (!window || window.resetAt <= now || window.count < limit) return 0;
  return Math.max(1, secondsLeft(window, now));
}

/** How many windows are held now; for tests. */
export const windowCount = (): number => windows.size;

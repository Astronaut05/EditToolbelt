/**
 * A fixed-window rate limit per key, in this process, with the `RateLimit-*`
 * headers docs/06 asks for on every answer.
 */
import { ApiError } from './problem';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * A fixed-window limit per key, in this process. Enough for one web server;
 * Cloudflare's edge limits sit in front of it from Go public on (docs/01).
 * Returns the `RateLimit-*` headers; throws 429 when the window is used up.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now = Date.now(),
): Record<string, string> {
  let window = windows.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowSec * 1000 };
    windows.set(key, window);
  }
  window.count += 1;
  const reset = Math.max(0, Math.ceil((window.resetAt - now) / 1000));
  const headers = {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, limit - window.count)),
    'RateLimit-Reset': String(reset),
  };
  if (window.count > limit) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Too many requests',
      `Try again in ${String(reset)} s.`,
      {},
      { ...headers, 'Retry-After': String(reset) },
    );
  }
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  return headers;
}

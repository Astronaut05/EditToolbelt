/**
 * Progress streams open at once, per account (GET /jobs/:id/events). Each
 * reads the job from the database every second or two for up to 15 minutes,
 * and the pool has 10 connections, so an account gets 5 at a time, counted
 * in this process; past that, 429 and polling GET /jobs/:id works as well.
 */
import { ApiError } from './problem';

export const MAX_STREAMS = 5;
/** A stream can end any moment; this is when to try again. */
const RETRY_AFTER_SEC = 15;

const open = new Map<string, number>();

/**
 * Takes one of the account's stream slots, or throws 429 RATE_LIMITED.
 * Answers the release, which is safe to call more than once.
 */
export function takeStream(account: string): () => void {
  const now = open.get(account) ?? 0;
  if (now >= MAX_STREAMS) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Too many progress streams',
      `At most ${String(MAX_STREAMS)} at once per account. Close one, or poll GET /jobs/{id}.`,
      {},
      { 'Retry-After': String(RETRY_AFTER_SEC) },
    );
  }
  open.set(account, now + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (open.get(account) ?? 1) - 1;
    if (left > 0) open.set(account, left);
    else open.delete(account);
  };
}

/** Streams the account has open; for tests. */
export const openStreams = (account: string): number => open.get(account) ?? 0;

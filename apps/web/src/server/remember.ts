/**
 * One answer for everyone who asks within a few seconds: the health
 * endpoints are open to anyone, and what they check (a query, a signed
 * storage call) is not free. Callers during a check share that check. A bad
 * answer is kept for a shorter time, so recovery shows quickly.
 */
export function remembered<T>(
  check: () => Promise<T>,
  { goodMs, badMs, good }: { goodMs: number; badMs: number; good: (value: T) => boolean },
  clock: () => number = Date.now,
): () => Promise<T> {
  let last: { at: number; value: T } | null = null;
  let pending: Promise<T> | null = null;
  return () => {
    if (last && clock() - last.at < (good(last.value) ? goodMs : badMs)) {
      return Promise.resolve(last.value);
    }
    pending ??= check()
      .then((value) => {
        last = { at: clock(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

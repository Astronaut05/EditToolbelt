/** Where to go after signing in: a path on this site only, never another origin. */
export function safeNext(next: unknown, fallback = '/account'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.includes('\\') || /[\r\n]/.test(next)) return fallback;
  return next;
}

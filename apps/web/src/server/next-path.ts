/**
 * Where to go after signing in: a path on this site only, never another origin.
 *
 * A browser reads a `Location` more loosely than a string check does: it drops
 * tabs and newlines, takes `\` for `/` and collapses dot segments, so
 * `/\t/evil.example` and `/.//evil.example` both land on `//evil.example`.
 * So the path is resolved against SITE_URL the way a browser would, and only a
 * same-origin result is kept, as its path, query and fragment. Control
 * characters, backslashes and encoded slashes are refused before that, also
 * once decoded, so no later decoding step can turn the answer into another
 * origin either.
 */
import { serverEnv } from './env';

/** C0 and C1 controls and DEL: tabs, newlines, NUL and the like. */
const CONTROL = /\p{Cc}/u;
/** `%2F` and `%5C` in the path: a slash or backslash once something decodes it. */
const ENCODED_SEPARATOR = /%2f|%5c/i;

/** The path, query and fragment `value` names on `site`, or null if it isn't one there. */
function sitePath(value: string, site: URL): string | null {
  if (!value.startsWith('/') || value.includes('\\') || CONTROL.test(value)) return null;
  const pathEnd = value.search(/[?#]/);
  if (ENCODED_SEPARATOR.test(pathEnd === -1 ? value : value.slice(0, pathEnd))) return null;
  let url: URL;
  try {
    url = new URL(value, site);
  } catch {
    return null;
  }
  if (url.origin !== site.origin) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // `/.//host` resolves to the path `//host`, which a browser reads as another origin.
  return path.startsWith('//') ? null : path;
}

export function safeNext(next: unknown, fallback = '/account', siteUrl?: string): string {
  if (typeof next !== 'string' || next.length > 2048) return fallback;
  const site = new URL(siteUrl ?? serverEnv().SITE_URL);
  const path = sitePath(next, site);
  if (path === null) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  return sitePath(decoded, site) === null ? fallback : path;
}

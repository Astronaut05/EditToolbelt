/**
 * A file name's stem, made safe for the names tools write (inside a ZIP, or
 * as a download): the extension dropped, every run of anything but letters,
 * digits, dashes and underscores made one dash, no dash at either end, at
 * most 60 characters. The ends are trimmed by a plain loop, not a regex that
 * backtracks, so a name of thousands of dashes costs no more than any other.
 */
export function safeStem(name: string, fallback: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot >= 0 ? name.slice(0, dot) : name).replace(/[^\p{L}\p{N}_-]+/gu, '-');
  let start = 0;
  let end = base.length;
  while (start < end && base[start] === '-') start += 1;
  while (end > start && base[end - 1] === '-') end -= 1;
  return base.slice(start, end).slice(0, 60) || fallback;
}

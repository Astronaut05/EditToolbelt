/**
 * The key a rate limit counts a caller's address under. Pure, and free of
 * server-only imports, so the proxy can use it too.
 *
 * An IPv4 address counts as itself. An IPv6 address counts by its /64: one
 * subscriber holds a whole /64, so counting each address on its own would
 * hand a single caller 2^64 fresh buckets. The address is only compared,
 * never kept or logged.
 */
export function addressKey(raw: string): string {
  const address = raw
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  if (!address.includes(':')) return address;
  // An IPv4 address written the IPv6 way is that IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  const [head = '', tail] = address.split('::');
  const left = head.split(':').filter(Boolean);
  const right = (tail ?? '').split(':').filter(Boolean);
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'),
          ...right,
        ];
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group, 16));
  if (prefix.length < 4 || prefix.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) {
    return address;
  }
  return `${prefix.map((n) => n.toString(16)).join(':')}::/64`;
}

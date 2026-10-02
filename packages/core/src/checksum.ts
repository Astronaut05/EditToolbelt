/**
 * U04 File Checksum (tools/utility.md): the pure parts. Pasted hashes are
 * read in the formats the tools print, results are checked against them by
 * file name, and the list is written for `sha256sum -c` and friends.
 */

export type HashAlgo = 'md5' | 'sha1' | 'sha256';

export const HASH_ALGOS: readonly HashAlgo[] = ['md5', 'sha1', 'sha256'];

export const HASH_LABEL: Record<HashAlgo, string> = {
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
};

const LENGTH: Record<HashAlgo, number> = { md5: 32, sha1: 40, sha256: 64 };

/** The algorithm a hex hash belongs to, by its length. */
export function algoOf(hex: string): HashAlgo | null {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  return HASH_ALGOS.find((algo) => LENGTH[algo] === clean.length) ?? null;
}

export interface Expected {
  /** Hashes given without a name: one of them checks a single file. */
  bare: string[];
  /** Hashes by file name, lower-cased (the list's names, without folders). */
  byName: Map<string, string>;
}

const baseName = (path: string) => path.replace(/^.*[\\/]/, '');

/**
 * Pasted hashes: one bare hash, or a list as `sha256sum` prints it
 * ("<hash>  <name>", binary mode "<hash> *<name>"), or BSD style
 * ("SHA256 (<name>) = <hash>"). Anything else on a line is ignored.
 */
export function parseExpected(text: string): Expected {
  const bare: string[] = [];
  const byName = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Split by position, not by regexes that backtrack over a long pasted line.
    const bsd = /^(?:MD5|SHA1|SHA-1|SHA256|SHA-256) ?\(/.exec(line)?.[0];
    if (bsd) {
      const close = line.lastIndexOf(')');
      const equals = line.indexOf('=', close);
      const hash = close >= bsd.length && equals > close ? line.slice(equals + 1).trim() : '';
      if (algoOf(hash)) {
        byName.set(baseName(line.slice(bsd.length, close)).toLowerCase(), hash.toLowerCase());
        continue;
      }
    }
    const hex = /^[0-9a-fA-F]+/.exec(line)?.[0] ?? '';
    const rest = line.slice(hex.length);
    const name = rest.trimStart().replace(/^\*/, '').trim();
    if (algoOf(hex) && rest !== rest.trimStart() && name) {
      byName.set(baseName(name).toLowerCase(), hex.toLowerCase());
      continue;
    }
    if (algoOf(line)) bare.push(line.toLowerCase());
  }
  return { bare, byName };
}

export type Check =
  | { kind: 'match'; algo: HashAlgo }
  | { kind: 'mismatch'; algo: HashAlgo; expected: string }
  | { kind: 'missing' }
  | { kind: 'none' };

/**
 * A file's hashes against what was pasted: its line in a list, by name, or
 * the one bare hash when there's no list. `missing`: a list was pasted and
 * this file isn't in it.
 */
export function checkFile(
  name: string,
  hashes: Partial<Record<HashAlgo, string>>,
  expected: Expected,
): Check {
  const listed = expected.byName.get(baseName(name).toLowerCase());
  const want =
    listed ??
    (expected.byName.size === 0 && expected.bare.length === 1 ? expected.bare[0] : undefined);
  if (!want) return expected.byName.size > 0 ? { kind: 'missing' } : { kind: 'none' };
  const algo = algoOf(want);
  if (!algo) return { kind: 'none' };
  return hashes[algo]?.toLowerCase() === want
    ? { kind: 'match', algo }
    : { kind: 'mismatch', algo, expected: want };
}

/** The list's file: `SHA256SUMS`-style for one algorithm (checkable with `sha256sum -c`), or CSV with all three. */
export function checksumList(
  rows: readonly { name: string; size: number; hashes: Partial<Record<HashAlgo, string>> }[],
  format: HashAlgo | 'csv',
): { text: string; name: string } {
  if (format === 'csv') {
    // A name a spreadsheet would read as a formula (=, +, -, @) is kept as text.
    const quote = (value: string) =>
      `"${/^[=+\-@\t\r]/.test(value) ? "'" : ''}${value.replaceAll('"', '""')}"`;
    const lines = [
      'file,bytes,md5,sha1,sha256',
      ...rows.map((row) =>
        [
          quote(row.name),
          String(row.size),
          row.hashes.md5 ?? '',
          row.hashes.sha1 ?? '',
          row.hashes.sha256 ?? '',
        ].join(','),
      ),
    ];
    return { text: `${lines.join('\n')}\n`, name: 'checksums.csv' };
  }
  const lines = rows
    .filter((row) => row.hashes[format])
    .map((row) => `${row.hashes[format] ?? ''}  ${row.name}`);
  return { text: `${lines.join('\n')}\n`, name: `${format.toUpperCase()}SUMS` };
}

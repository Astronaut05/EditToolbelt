/**
 * Runs after `next build`:
 * 1. Gives generated Open Graph images a .png name (the export writes them
 *    without an extension, which hosts serve as octet-stream) and points the
 *    pages at the new name.
 * 2. Writes the per-page CSP into every exported HTML file (scripts/csp.ts),
 *    last, because it hashes the final inline scripts.
 * `_headers` and the rest come from the build itself.
 */
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injectCsp, originOf } from './csp.ts';

const OUT = fileURLToPath(new URL('../out', import.meta.url));

function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesIn(path, keep);
    return keep(name) ? [path] : [];
  });
}

const OG = 'opengraph-image';
const og = filesIn(OUT, (name) => name === OG);
for (const file of og) renameSync(file, `${file}.png`);

const pages = filesIn(OUT, (name) => name.endsWith('.html') || name.endsWith('.txt'));
for (const file of pages) {
  const text = readFileSync(file, 'utf8');
  const fixed = text.replaceAll(`/${OG}?`, `/${OG}.png?`);
  if (fixed !== text) writeFileSync(file, fixed);
}

const connect = [originOf(process.env.MODELS_BASE_URL), originOf(process.env.ANALYTICS_URL)].filter(
  (origin): origin is string => origin !== null,
);

const html = pages.filter((file) => file.endsWith('.html'));
for (const file of html) writeFileSync(file, injectCsp(readFileSync(file, 'utf8'), { connect }));
console.log(
  `${String(og.length)} OG images renamed; CSP written into ${String(html.length)} pages${connect.length ? ` (connect-src + ${connect.join(' ')})` : ''}.`,
);

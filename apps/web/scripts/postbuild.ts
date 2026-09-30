/**
 * Runs after `next build`:
 * 1. Gives generated Open Graph images a .png name (the export writes them
 *    without an extension, which hosts serve as octet-stream) and points the
 *    pages at the new name.
 * 2. Writes /favicon.ico from the 32 px icon (scripts/ico.ts).
 * 3. Writes the service worker with the app shell precache list (scripts/sw.ts).
 * 4. Writes the per-page CSP into every exported HTML file (scripts/csp.ts),
 *    last, because it hashes the final inline scripts.
 * `_headers` and the rest come from the build itself.
 */
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injectCsp, originOf } from './csp.ts';
import { pngToIco } from './ico.ts';
import { assetsIn, serviceWorker } from './sw.ts';

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

writeFileSync(
  join(OUT, 'favicon.ico'),
  pngToIco(readFileSync(join(OUT, 'icons/favicon-32.png')), 32),
);

const connect = [originOf(process.env.MODELS_BASE_URL), originOf(process.env.ANALYTICS_URL)].filter(
  (origin): origin is string => origin !== null,
);

const shellPages = ['index.html', 'offline.html'].map((name) => join(OUT, name));
const precache = [
  '/',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  ...shellPages.flatMap((file) => assetsIn(readFileSync(file, 'utf8'))),
];
writeFileSync(
  join(OUT, 'sw.js'),
  serviceWorker({ precache, modelsOrigin: originOf(process.env.MODELS_BASE_URL) }),
);

const html = pages.filter((file) => file.endsWith('.html'));
for (const file of html) writeFileSync(file, injectCsp(readFileSync(file, 'utf8'), { connect }));
console.log(
  `${String(og.length)} OG images renamed; service worker precaches ${String(precache.length)} files; CSP written into ${String(html.length)} pages${connect.length ? ` (connect-src + ${connect.join(' ')})` : ''}.`,
);

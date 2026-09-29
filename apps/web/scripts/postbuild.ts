/**
 * Runs after `next build`: writes the per-page CSP into every exported HTML
 * file (scripts/csp.ts). `_headers` and the rest come from the build itself.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injectCsp, originOf } from './csp.ts';

const OUT = fileURLToPath(new URL('../out', import.meta.url));

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

const connect = [originOf(process.env.MODELS_BASE_URL), originOf(process.env.ANALYTICS_URL)].filter(
  (origin): origin is string => origin !== null,
);

const files = htmlFiles(OUT);
for (const file of files) writeFileSync(file, injectCsp(readFileSync(file, 'utf8'), { connect }));
console.log(
  `CSP written into ${String(files.length)} pages${connect.length ? ` (connect-src + ${connect.join(' ')})` : ''}.`,
);

/**
 * Initial JS budget (docs/10 → Budgets): the gzip size of the module scripts a
 * page loads before any engine, measured on the static export. The legacy
 * `nomodule` polyfill is left out, since browsers that run modules never load
 * it. Run after `pnpm build`: node scripts/js-budget.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Reset in M1 from docs/10's 120 KB: see docs/DECISIONS.md → "Initial JS budget". */
export const BUDGET_KB = 150;
const PAGES = [
  'index.html',
  'photo.html',
  'remove-background.html',
  'timecode-calculator.html',
  'video-converter.html',
  'privacy.html',
];

export function moduleScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => !/\bnomodule\b/i.test(tag))
    .map((tag) => /\bsrc="([^"?#]+)/i.exec(tag)?.[1])
    .filter((src): src is string => Boolean(src));
}

function main(): number {
  const out = fileURLToPath(new URL('../out', import.meta.url));
  let failed = false;
  for (const page of PAGES) {
    const html = readFileSync(join(out, page), 'utf8');
    const bytes = moduleScripts(html).reduce(
      (sum, src) => sum + gzipSync(readFileSync(join(out, src)), { level: 9 }).length,
      0,
    );
    const kb = bytes / 1024;
    const over = kb > BUDGET_KB;
    failed ||= over;
    console.log(
      `${over ? '✗' : '✓'} ${page.padEnd(26)} ${kb.toFixed(1)} KB gzip (budget ${String(BUDGET_KB)} KB)`,
    );
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();

/**
 * Lighthouse budgets (docs/10 → Budgets) on 5 representative pages of the
 * production build, served by `pnpm preview`'s server (headers, CSP,
 * compression). Lighthouse's default mobile config: emulated phone, simulated
 * slow 4G and a 4× slower CPU, so these are lab ceilings, stricter than the
 * real-user p75 budgets. Reports go to apps/web/.lighthouse/ (never uploaded).
 *
 *   pnpm build && pnpm lighthouse          (CHROME_PATH picks the browser)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_PORT = 4175;
const DEBUG_PORT = 9333;
const PAGES = ['/', '/photo', '/remove-background', '/video-converter', '/privacy'];

interface Budget {
  label: string;
  read: (lhr: Result) => number;
  max?: number;
  min?: number;
  unit: string;
}

type Result = {
  categories: Record<string, { score: number | null }>;
  audits: Record<
    string,
    {
      numericValue?: number;
      details?: { items?: { resourceType?: string; transferSize?: number }[] };
    }
  >;
};

const score = (name: string) => (lhr: Result) => (lhr.categories[name]?.score ?? 0) * 100;
const metric = (name: string) => (lhr: Result) => lhr.audits[name]?.numericValue ?? Infinity;

export const BUDGETS: Budget[] = [
  { label: 'performance', read: score('performance'), min: 90, unit: '' },
  { label: 'accessibility', read: score('accessibility'), min: 95, unit: '' },
  { label: 'best practices', read: score('best-practices'), min: 90, unit: '' },
  { label: 'LCP', read: metric('largest-contentful-paint'), max: 2500, unit: 'ms' },
  { label: 'CLS', read: metric('cumulative-layout-shift'), max: 0.05, unit: '' },
  { label: 'TBT', read: metric('total-blocking-time'), max: 150, unit: 'ms' },
  {
    label: 'script transfer',
    read: (lhr) =>
      (lhr.audits['resource-summary']?.details?.items ?? []).find(
        (item) => item.resourceType === 'script',
      )?.transferSize ?? 0,
    max: 160_000,
    unit: 'B',
  },
];

function waitFor(url: string, timeoutMs = 15_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then(() => {
          resolve();
        })
        .catch(() => {
          if (Date.now() > until) reject(new Error(`${url} did not come up`));
          else setTimeout(tick, 200);
        });
    };
    tick();
  });
}

async function main(): Promise<number> {
  const out = join(ROOT, 'apps/web/.lighthouse');
  mkdirSync(out, { recursive: true });
  const children: ChildProcess[] = [];
  try {
    children.push(
      spawn(
        process.execPath,
        [join(ROOT, 'apps/web/scripts/serve.ts'), '--port', String(SITE_PORT)],
        { stdio: 'ignore' },
      ),
    );
    const chrome = process.env.CHROME_PATH ?? chromium.executablePath();
    children.push(
      spawn(
        chrome,
        [
          '--headless=new',
          '--no-sandbox',
          '--no-first-run',
          `--remote-debugging-port=${String(DEBUG_PORT)}`,
          `--user-data-dir=${mkdtempSync(join(tmpdir(), 'etb-lh-'))}`,
          'about:blank',
        ],
        { stdio: 'ignore' },
      ),
    );
    await waitFor(`http://localhost:${String(SITE_PORT)}/`);
    await waitFor(`http://127.0.0.1:${String(DEBUG_PORT)}/json/version`);

    const failures: string[] = [];
    for (const path of PAGES) {
      const url = `http://localhost:${String(SITE_PORT)}${path}`;
      const run = await lighthouse(url, { port: DEBUG_PORT, output: 'json', logLevel: 'error' });
      if (!run) throw new Error(`No result for ${url}`);
      const lhr = run.lhr as unknown as Result;
      writeFileSync(
        join(out, `${path === '/' ? 'home' : path.slice(1)}.json`),
        run.report as string,
      );
      const cells = BUDGETS.map((budget) => {
        const value = budget.read(lhr);
        const ok =
          (budget.min === undefined || value >= budget.min) &&
          (budget.max === undefined || value <= budget.max);
        if (!ok) failures.push(`${path} ${budget.label}`);
        const shown =
          budget.unit === 'B'
            ? `${(value / 1024).toFixed(0)}KB`
            : budget.unit === 'ms'
              ? `${String(Math.round(value))}ms`
              : String(Math.round(value * 1000) / 1000);
        return `${ok ? '' : '✗ '}${budget.label} ${shown}`;
      });
      console.log(`${path.padEnd(20)} ${cells.join(' · ')}`);
    }
    console.log(
      failures.length
        ? `\nLighthouse budgets failed: ${failures.join(', ')}`
        : '\nLighthouse budgets met.',
    );
    return failures.length ? 1 : 0;
  } finally {
    for (const child of children) child.kill();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

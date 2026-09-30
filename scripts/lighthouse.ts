/**
 * Lighthouse budgets (docs/10 → Budgets) on 6 representative pages of the
 * production build, served by `pnpm preview`'s server (headers, CSP,
 * compression). Lighthouse's default mobile config: emulated phone, simulated
 * slow 4G and a 4× slower CPU, so these are lab ceilings, stricter than the
 * real-user p75 budgets. One run swings LCP by a few hundred ms, so each page
 * runs RUNS times and the budgets read Lighthouse's own median run (closest to
 * the median FCP and TTI), as its variability guide recommends. Reports (the
 * median run) go to apps/web/.lighthouse/ (never uploaded).
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
/** Home, a hub, a light tool, the heaviest tool (P07), a coming-soon page and the isolated route. */
const PAGES = [
  '/',
  '/photo',
  '/timecode-calculator',
  '/remove-background',
  '/upscale-image',
  '/video-converter',
];
/**
 * Pages whose working tool (ToolShell and the tool's own view, not its
 * engine) loads with them: script transfer up to 180 KB instead of 160 KB.
 * See docs/DECISIONS.md → "Script budget for working tool pages".
 */
const TOOL_PAGES = new Set(['/remove-background']);
const TOOL_SCRIPT_MAX = 180_000;
/** Odd, so the median is one of the runs. */
const RUNS = 3;

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

/**
 * Lighthouse's median run (core/lib/median-run.js): the run closest to the
 * median FCP and median TTI, the earliest and latest moments of the load.
 */
function medianRun<T extends { lhr: Result }>(runs: T[]): T {
  const value = (run: T, audit: string) => run.lhr.audits[audit]?.numericValue ?? NaN;
  const median = (audit: string) =>
    runs.map((run) => value(run, audit)).sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? NaN;
  const fcp = median('first-contentful-paint');
  const tti = median('interactive');
  const distance = (run: T) =>
    (value(run, 'first-contentful-paint') - fcp) ** 2 + (value(run, 'interactive') - tti) ** 2;
  const [best] = runs.toSorted((a, b) => distance(a) - distance(b));
  if (!best) throw new Error('No Lighthouse runs');
  return best;
}

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
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const run = await lighthouse(url, { port: DEBUG_PORT, output: 'json', logLevel: 'error' });
        if (!run) throw new Error(`No result for ${url}`);
        runs.push({ lhr: run.lhr as unknown as Result, report: run.report as string });
      }
      const { lhr, report } = medianRun(runs);
      writeFileSync(join(out, `${path === '/' ? 'home' : path.slice(1)}.json`), report);
      const cells = BUDGETS.map((budget) => {
        const value = budget.read(lhr);
        const max =
          budget.label === 'script transfer' && TOOL_PAGES.has(path) ? TOOL_SCRIPT_MAX : budget.max;
        const ok =
          (budget.min === undefined || value >= budget.min) && (max === undefined || value <= max);
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
        ? `\nLighthouse budgets failed (median of ${String(RUNS)} runs): ${failures.join(', ')}`
        : `\nLighthouse budgets met (median of ${String(RUNS)} runs).`,
    );
    return failures.length ? 1 : 0;
  } finally {
    for (const child of children) child.kill();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

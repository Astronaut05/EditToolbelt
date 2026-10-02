/**
 * Lighthouse budgets (docs/10 → Budgets) on 6 representative pages of the
 * production build, served by `pnpm preview`'s server (headers, CSP,
 * compression). Lighthouse's default mobile config: emulated phone, simulated
 * slow 4G and a 4× slower CPU, so these are lab ceilings, stricter than the
 * real-user p75 budgets. Each page runs RUNS times and each budget reads the
 * median of its own values across the runs, as Lighthouse's variability guide
 * recommends.
 *
 * LCP is the exception: it reads APPLIED_RUNS runs with applied throttling
 * (the network and CPU really slowed, as DevTools does). Simulated LCP on a
 * localhost trace counts every script that arrived before the first paint,
 * which on a local server is all of them, so it swings with task timing
 * (1966 to 2651 ms on one build); applied, the same page reads 1602 to 1771 ms.
 *
 * Next's router prefetches the pages that links on screen lead to (their
 * `?_rsc=` payloads, then their code) once the page is idle. Whether that
 * landed inside a run decided the script transfer: /remove-background read
 * 179,374 B without the home page's code and 183,624 B with it. Those requests
 * are blocked (BLOCKED), so each run counts the page's own scripts alone, and
 * the same build reads the same bytes every run.
 *
 * Reports (Lighthouse's median simulated run, closest to the median FCP and
 * TTI) go to apps/web/.lighthouse/ (never uploaded).
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

import { PAGE_SCRIPT_MAX, TOOL_SCRIPT_MAX } from '../apps/web/scripts/script-budget.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_PORT = 4175;
const DEBUG_PORT = 9333;
/** Home, a hub, a light tool, the heaviest tool (P07), a coming-soon page and a video tool (V03). */
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
 * engine) loads with them: script transfer up to TOOL_SCRIPT_MAX instead of
 * PAGE_SCRIPT_MAX (apps/web/scripts/script-budget.ts). Every other page is
 * held to the same budgets by apps/web/e2e/script-budget.spec.ts.
 */
const TOOL_PAGES = new Set(['/remove-background', '/video-converter']);
/** The router's prefetches of other pages (see the top of this file). */
const BLOCKED = ['*_rsc=*'];
/** Odd, so each median is one of the runs' values. */
const RUNS = 5;
/** Runs with applied throttling, for the budgets marked `applied` (LCP). */
const APPLIED_RUNS = 3;

interface Budget {
  label: string;
  /** Read from the runs with applied throttling (see the top of this file). */
  applied?: boolean;
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
  {
    label: 'LCP',
    read: metric('largest-contentful-paint'),
    max: 2500,
    unit: 'ms',
    applied: true,
  },
  { label: 'CLS', read: metric('cumulative-layout-shift'), max: 0.05, unit: '' },
  { label: 'TBT', read: metric('total-blocking-time'), max: 150, unit: 'ms' },
  {
    label: 'script transfer',
    read: (lhr) =>
      (lhr.audits['resource-summary']?.details?.items ?? []).find(
        (item) => item.resourceType === 'script',
      )?.transferSize ?? 0,
    max: PAGE_SCRIPT_MAX,
    unit: 'B',
  },
];

/** The median of one budget's values across the runs. */
export function medianValue(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
}

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
      const runs: { lhr: Result; report: string }[] = [];
      for (let i = 0; i < RUNS; i++) {
        const run = await lighthouse(url, {
          port: DEBUG_PORT,
          output: 'json',
          logLevel: 'error',
          blockedUrlPatterns: BLOCKED,
        });
        if (!run) throw new Error(`No result for ${url}`);
        runs.push({ lhr: run.lhr as unknown as Result, report: run.report as string });
      }
      const applied: Result[] = [];
      for (let i = 0; i < APPLIED_RUNS; i++) {
        const run = await lighthouse(
          url,
          { port: DEBUG_PORT, output: 'json', logLevel: 'error', blockedUrlPatterns: BLOCKED },
          {
            extends: 'lighthouse:default',
            settings: { throttlingMethod: 'devtools', onlyCategories: ['performance'] },
          },
        );
        if (!run) throw new Error(`No result for ${url}`);
        applied.push(run.lhr as unknown as Result);
      }
      // The saved report is Lighthouse's median run; each budget reads its own
      // median, since the run with the median FCP and TTI can hold any run's
      // LCP (simulated LCP scales with main-thread timing, which varies by run).
      const { report } = medianRun(runs);
      writeFileSync(join(out, `${path === '/' ? 'home' : path.slice(1)}.json`), report);
      const cells = BUDGETS.map((budget) => {
        const value = medianValue(
          budget.applied ? applied.map(budget.read) : runs.map((run) => budget.read(run.lhr)),
        );
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
        ? `\nLighthouse budgets failed (median of ${String(RUNS)} runs, LCP of ${String(APPLIED_RUNS)} with applied throttling): ${failures.join(', ')}`
        : `\nLighthouse budgets met (median of ${String(RUNS)} runs, LCP of ${String(APPLIED_RUNS)} with applied throttling).`,
    );
    return failures.length ? 1 : 0;
  } finally {
    for (const child of children) child.kill();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

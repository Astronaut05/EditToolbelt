import {
  categories,
  categoryPath,
  conversionPath,
  isAvailable,
  livePairs,
  toolPath,
  tools,
} from '@etb/registry';
import type { Page } from '@playwright/test';

import { PAGE_SCRIPT_MAX, TOOL_SCRIPT_MAX } from '../scripts/script-budget';
import { expect, remote, test } from './fixtures';

// The script-transfer budgets Lighthouse checks on six pages
// (scripts/lighthouse.ts), on every page: a page whose tool works up to
// TOOL_SCRIPT_MAX, every other page (home, hubs, coming soon) up to
// PAGE_SCRIPT_MAX (../scripts/script-budget.ts). The bytes are what
// Lighthouse's `resource-summary` counts: each script's compressed transfer,
// headers included, as scripts/serve.ts sends it, so this reads the same
// number in a second or two a page. Next's link prefetches of other pages'
// code are left out (docs/decisions/2026-10-02-script-budget-on-every-page.md).
// Chromium on a desktop only, and only the local build: the bytes don't
// depend on the browser.

const PAGES: { path: string; max: number }[] = [
  { path: '/', max: PAGE_SCRIPT_MAX },
  ...categories.map((category) => ({ path: categoryPath(category), max: PAGE_SCRIPT_MAX })),
  ...tools.map((tool) => ({
    path: toolPath(tool),
    max: isAvailable(tool) ? TOOL_SCRIPT_MAX : PAGE_SCRIPT_MAX,
  })),
  ...livePairs().map((pair) => ({ path: conversionPath(pair), max: TOOL_SCRIPT_MAX })),
];

test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
  'the same bytes in every browser; Chromium reports them',
);
test.skip(remote, 'every page once, on the local build');

/** Bytes of script the page loads until the network is idle, as Lighthouse counts them. */
async function scriptBytes(
  page: Page,
  path: string,
): Promise<{ total: number; scripts: string[] }> {
  // Next's router prefetches (`?_rsc=` payloads, then those pages' code) are
  // other pages' scripts; Lighthouse's runs block them the same way.
  await page.route(/_rsc=/, (route) => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const urls = new Map<string, string>();
  const bytes = new Map<string, number>();
  cdp.on('Network.responseReceived', (event) => {
    if (event.type === 'Script') urls.set(event.requestId, event.response.url);
  });
  cdp.on('Network.loadingFinished', (event) => {
    if (urls.has(event.requestId)) bytes.set(event.requestId, event.encodedDataLength);
  });
  cdp.on('Network.loadingFailed', (event) => {
    urls.delete(event.requestId);
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  // This session's events can trail Playwright's idle by a moment.
  await expect.poll(() => bytes.size).toBe(urls.size);
  const total = [...bytes.values()].reduce((sum, size) => sum + size, 0);
  const scripts = [...bytes]
    .sort((a, b) => b[1] - a[1])
    .map(([id, size]) => `${String(size).padStart(7)}  ${new URL(urls.get(id) ?? '').pathname}`);
  return { total, scripts };
}

for (const { path, max } of PAGES) {
  test(path, async ({ page }) => {
    const { total, scripts } = await scriptBytes(page, path);
    expect(
      total,
      `${path}: ${String(total)} bytes of script, over ${String(max)}:\n${scripts.join('\n')}`,
    ).toBeLessThanOrEqual(max);
  });
}

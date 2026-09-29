/**
 * Design check: screenshots each design screen's route at the PNG's size and
 * theme, and writes <out>/<screen>.png with the design on the left and the
 * build on the right. Needs the workshop build being served:
 *
 *   pnpm workshop                        (terminal 1: build + serve on :4173)
 *   pnpm design:compare [outDir] [--extra]   (terminal 2, default ./screens-compare)
 *
 * --extra also shoots pages that have no design PNG (phone home, hub, coming
 * soon, and the real routes) for review. PW_CHROMIUM picks the browser binary.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DESIGN = join(ROOT, 'docs/design/screens');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const args = process.argv.slice(2);
const out = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'screens-compare');
mkdirSync(out, { recursive: true });

type Theme = 'light' | 'dark';
interface Shot {
  name: string;
  route: string;
  width: number;
  height: number;
  design?: string;
}

const pairs: Shot[] = [
  { name: 'home', route: '/workshop/screens/home', width: 1440, height: 900 },
  { name: 'hub-photo', route: '/workshop/screens/hub-photo', width: 1440, height: 1040 },
  { name: 'soon-upscale', route: '/workshop/screens/soon-upscale', width: 1440, height: 900 },
  { name: 'tool-empty', route: '/workshop/screens/tool-empty', width: 1440, height: 900 },
  { name: 'tool-progress', route: '/workshop/screens/tool-progress', width: 1440, height: 900 },
  { name: 'tool-result', route: '/workshop/screens/tool-result', width: 1440, height: 900 },
  { name: 'phone-empty', route: '/workshop/screens/tool-empty', width: 390, height: 844 },
  { name: 'phone-result', route: '/workshop/screens/tool-result', width: 390, height: 844 },
].map((shot) => ({ ...shot, design: shot.name }));

const extras: Shot[] = [
  { name: 'phone-home', route: '/workshop/screens/home', width: 390, height: 844 },
  { name: 'phone-hub-photo', route: '/workshop/screens/hub-photo', width: 390, height: 844 },
  { name: 'phone-soon-upscale', route: '/workshop/screens/soon-upscale', width: 390, height: 844 },
  { name: 'real-home', route: '/', width: 1440, height: 900 },
  { name: 'real-hub-video', route: '/video', width: 1440, height: 900 },
  { name: 'real-soon-remove-background', route: '/remove-background', width: 1440, height: 900 },
  {
    name: 'real-phone-soon-remove-background',
    route: '/remove-background',
    width: 390,
    height: 844,
  },
  { name: 'real-privacy', route: '/privacy', width: 1440, height: 900 },
  { name: 'real-404', route: '/nope', width: 1440, height: 900 },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

async function capture(shot: Shot, theme: Theme): Promise<Buffer> {
  const page: Page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    colorScheme: theme,
  });
  await page.goto(BASE + shot.route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Settle the search index fetch and any hydration.
  await page.waitForTimeout(250);
  const png = await page.screenshot();
  await page.close();
  return png;
}

async function sideBySide(
  name: string,
  left: Buffer | null,
  right: Buffer,
  width: number,
  height: number,
) {
  const page = await browser.newPage({
    viewport: { width: left ? width * 2 + 24 : width, height: height + 40 },
  });
  const img = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;
  const cell = (label: string, buf: Buffer) =>
    `<figure><figcaption>${label}</figcaption><img src="${img(buf)}" width="${String(width)}" height="${String(height)}"></figure>`;
  await page.setContent(
    `<style>body{margin:0;display:flex;gap:24px;background:#777;font:600 14px monospace;color:#fff}figure{margin:0}figcaption{height:40px;line-height:40px;padding-left:8px}img{display:block}</style>` +
      (left ? cell(`DESIGN · ${name}`, left) : '') +
      cell(`BUILT · ${name}`, right),
  );
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}

for (const theme of ['light', 'dark'] as const) {
  for (const shot of pairs) {
    const built = await capture(shot, theme);
    const design = readFileSync(join(DESIGN, `${shot.design ?? shot.name}-${theme}.png`));
    await sideBySide(`${shot.name}-${theme}`, design, built, shot.width, shot.height);
  }
  if (args.includes('--extra')) {
    for (const shot of extras) {
      await sideBySide(
        `${shot.name}-${theme}`,
        null,
        await capture(shot, theme),
        shot.width,
        shot.height,
      );
    }
  }
}
await browser.close();
console.log(`Wrote side-by-side screenshots to ${out}`);

/**
 * Renders the sample images in apps/web/public/samples/ from mug.html:
 *   mug.jpg         the "photo" (Try a sample on Remove Background)
 *   mug-cutout.png  the same mug on transparency (the expected result)
 *
 * Run: pnpm samples  (needs the Playwright Chromium; set PW_CHROMIUM to use
 * another executable). The outputs are committed; rerun only after editing mug.html.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'apps/web/public/samples');
const page = pathToFileURL(join(ROOT, 'scripts/samples/mug.html')).href;

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const tab = await browser.newPage({
  viewport: { width: 880, height: 844 },
  deviceScaleFactor: 1.5,
});
await tab.goto(page);
await tab.screenshot({ path: join(OUT, 'mug.jpg'), type: 'jpeg', quality: 86 });
await tab.goto(`${page}?cutout=1`);
await tab.screenshot({ path: join(OUT, 'mug-cutout.png'), omitBackground: true });
await browser.close();
console.log(`Samples written to ${OUT}`);

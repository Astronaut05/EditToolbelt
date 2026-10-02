// Temporary (claude/debug-watermark only, never merged): the Chromium-only
// hang in watermark-image.spec.ts:95 on CI. Logs every step with a time, the
// page's anchor clicks and object-URL revokes, and each download; a lost
// download is reported and retried instead of timing out the test.
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, expect, test } from './fixtures';

async function flat(page: Page, width: number, height: number, color = '#808080') {
  const base64 = await page.evaluate(
    async ([w, h, fill]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height, color] as const,
  );
  return Buffer.from(base64, 'base64');
}

const sizes = [
  [400, 300],
  [300, 400],
  [1000, 500],
  [640, 640],
  [900, 1600],
  [1200, 800],
  [800, 1200],
  [720, 1280],
  [1024, 768],
  [500, 1000],
  [333, 777],
  [1500, 500],
  [256, 256],
  [1280, 720],
  [600, 900],
  [1600, 1200],
  [480, 640],
  [1600, 900],
  [350, 350],
  [1100, 700],
] as const;

test('zzdebug watermark 20 downloads', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop only');
  test.setTimeout(420_000);
  const t0 = Date.now();
  const log = (message: string) => {
    console.log(
      `[${testInfo.project.name} r${String(testInfo.repeatEachIndex)} w${String(testInfo.workerIndex)}] +${((Date.now() - t0) / 1000).toFixed(2)}s ${message}`,
    );
  };
  page.on('download', (d) => {
    log(`download event ${d.suggestedFilename()} ${d.url().slice(0, 70)}`);
  });
  page.on('console', (m) => {
    log(`console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => {
    log(`pageerror ${e.message}`);
  });
  page.on('crash', () => {
    log('CRASH');
  });
  page.on('popup', (p) => {
    log(`popup ${p.url()}`);
  });
  page.on('framenavigated', (f) => {
    log(`framenavigated ${f.url().slice(0, 100)}`);
  });
  page.on('worker', (w) => {
    log(`worker ${w.url().slice(0, 100)}`);
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __dl: string[] };
    w.__dl = [];
    const t = () => performance.now().toFixed(0);
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      w.__dl.push(
        `${t()} a.click href=${this.href.slice(0, 70)} download=${this.download} connected=${String(this.isConnected)} active=${String(navigator.userActivation.isActive)}`,
      );
      click.call(this);
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      w.__dl.push(`${t()} revoke ${url.slice(0, 70)}`);
      revoke(url);
    };
    document.addEventListener(
      'click',
      (event) => {
        const el = event.target as Element;
        w.__dl.push(
          `${t()} click on ${el.tagName} "${(el.textContent ?? '').slice(0, 40)}" trusted=${String(event.isTrusted)}`,
        );
      },
      true,
    );
  });
  const drain = async () => {
    const lines = await page.evaluate(() => {
      const w = window as unknown as { __dl: string[] };
      const out = w.__dl;
      w.__dl = [];
      return out;
    });
    for (const line of lines) log(`  page: ${line}`);
  };

  await page.goto('/watermark-image');
  log('loaded');
  const files = [];
  for (const [i, [w, h]] of sizes.entries()) {
    files.push({
      name: `img-${String(i)}.png`,
      mimeType: 'image/png',
      buffer: await flat(page, w, h),
    });
  }
  log('made 20 inputs');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(files);
  const start = page.getByRole('button', { name: 'Add watermark · 20 files' });
  await expect(page.getByText('Type the watermark text.').first()).toBeVisible();
  await choose(page, false, 'Watermark', 'Logo');
  const panel = page.getByRole('region', { name: 'Settings' });
  await panel.locator('input[type=file][aria-label="Logo"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await flat(page, 100, 50, '#ff0000'),
  });
  await panel.getByRole('slider', { name: 'Opacity' }).fill('100');
  log('settings set');
  const poll = setInterval(() => {
    void page
      .evaluate(() =>
        Array.from(document.querySelectorAll('tbody tr'))
          .map(
            (row) => (row.textContent ?? '').match(/Queued|Working[^L]*|Done|Failed/)?.[0] ?? '?',
          )
          .join(','),
      )
      .then((s) => {
        log(`rows: ${s}`);
      })
      .catch(() => undefined);
  }, 3000);
  await start.click();
  log('started');
  await expect(page.getByRole('button', { name: 'Download all · ZIP' })).toBeEnabled({
    timeout: 300_000,
  });
  clearInterval(poll);
  log('zip enabled (batch done)');
  await drain();
  const lost: number[] = [];
  for (const [i, [w, h]] of sizes.entries()) {
    const button = page.getByRole('button', { name: `Download img-${String(i)}.png` });
    log(`click ${String(i)}`);
    let saved = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await button.click();
    log(`clicked ${String(i)}`);
    let file = await saved;
    await drain();
    if (!file) {
      lost.push(i);
      log(`LOST ${String(i)}: no download in 15 s; clicking again`);
      saved = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      await button.click();
      file = await saved;
      await drain();
      log(
        file ? `second click on ${String(i)} downloaded` : `second click on ${String(i)} LOST too`,
      );
      if (!file) continue;
    }
    const path = await file.path();
    log(
      `got ${String(i)} ${file.suggestedFilename()} ${String(readFileSync(path).length)} B (${String(w)}x${String(h)})`,
    );
  }
  log(`done, lost: ${JSON.stringify(lost)}`);
  expect(lost).toEqual([]);
});

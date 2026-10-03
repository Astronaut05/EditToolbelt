import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

// The shared ToolShell for keyboard and screen-reader users: where focus goes
// as a file arrives and a run ends (WCAG 2.4.3), what the status line says
// (4.1.3), that nothing with focus hides under the phone's action bar or the
// header (2.4.11), and the hub's filter count.

const FACE = fileURLToPath(new URL('../../../fixtures/photo/face.jpg', import.meta.url));
const SPEECH = fileURLToPath(new URL('../../../fixtures/audio/noisy-speech.wav', import.meta.url));

/** Records each new line any status region says from now on, in order. */
async function listen(page: Page) {
  await page.evaluate(() => {
    const said: string[] = [];
    const last = new WeakMap<Element, string>();
    for (const node of document.querySelectorAll('[role=status]')) {
      last.set(node, node.textContent);
    }
    (window as unknown as { __said: string[] }).__said = said;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[role=status]')) {
        const text = node.textContent;
        if (text.trim() && text !== last.get(node)) said.push(text.trim());
        last.set(node, text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

const said = (page: Page) =>
  page.evaluate(() => (window as unknown as { __said: string[] }).__said);

test('a run is spoken, and focus goes to the settings, then to Download', async ({
  page,
  isMobile,
}) => {
  await page.goto('/compress-image');
  await listen(page);
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(FACE);
  // The first setting on a computer; its row (which opens the sheet) on a phone.
  await expect(
    isMobile
      ? page.getByRole('button', { name: /^Compress by/ })
      : page.getByRole('radio', { name: 'Quality', exact: true }),
  ).toBeFocused();
  await expect.poll(() => said(page)).toEqual(['face.jpg loaded']);

  await page.getByRole('button', { name: 'Compress', exact: true }).focus();
  await page.keyboard.press('Enter');
  const download = page.getByRole('button', { name: /^Download JPG/ });
  await expect(download).toBeEnabled({ timeout: 30_000 });
  await expect(download).toBeFocused();
  // The run's title once, then the result: never each percent.
  await expect
    .poll(() => said(page))
    .toEqual(['face.jpg loaded', 'Working', expect.stringMatching(/^Done: JPG, \d+\.\d (KB|MB)$/)]);

  // Start over: back to the button that chooses a file.
  await page.getByRole('button', { name: 'Start over' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Workspace' }).getByRole('button').first(),
  ).toBeFocused();
});

test('a refused file is spoken, and focus goes to what to do next', async ({ page }) => {
  await page.goto('/compress-image');
  await listen(page);
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.getByRole('button', { name: 'Try another file' })).toBeFocused();
  await expect.poll(() => said(page)).toEqual(['This file won’t work here']);
});

/** Tabs through the page; the controls whose centre the action bar or the header covers. */
async function hiddenUnderBars(page: Page, tabs: number): Promise<string[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const hidden: string[] = [];
  for (let i = 0; i < tabs; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      const bars = [...document.querySelectorAll('[data-action-bar], header')];
      if (bars.some((bar) => bar.contains(active))) return null;
      const box = active.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, (box.left + box.right) / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, (box.top + box.bottom) / 2));
      const top = document.elementFromPoint(x, y);
      if (!top || !bars.some((bar) => bar.contains(top))) return null;
      const name = (active.getAttribute('aria-label') ?? active.textContent).trim();
      return `${active.tagName} "${name.slice(0, 40)}" at y=${String(Math.round(box.top))}`;
    });
    if (found) hidden.push(found);
  }
  return hidden;
}

test.describe('at 320 px (a phone, or 400% zoom)', () => {
  test.skip(({ isMobile }) => !isMobile, 'the phone layout');
  test.use({ viewport: { width: 320, height: 640 } });

  test('Compress Image: nothing with focus hides under the bar or the header', async ({ page }) => {
    await page.goto('/compress-image');
    await page.locator('input[type=file][data-hydrated]').first().setInputFiles(FACE);
    await expect(page.getByRole('button', { name: 'Compress', exact: true })).toBeVisible();
    expect(await hiddenUnderBars(page, 45)).toEqual([]);
  });

  test('Trim Audio: nothing with focus hides under the bar or the header', async ({ page }) => {
    await page.goto('/trim-audio');
    await page.locator('input[type=file][data-hydrated]').first().setInputFiles(SPEECH);
    await expect(page.getByRole('group', { name: /^Timeline/ })).toBeVisible();
    expect(await hiddenUnderBars(page, 45)).toEqual([]);
  });
});

test('the timeline says where the playhead is when the keys move it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('/trim-audio');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(SPEECH);
  // Audio steps by the millisecond, and the label says so.
  const timeline = page.getByRole('group', { name: /^Timeline\. .* by 1 ms,/ });
  await timeline.focus();
  await listen(page);
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  // Said once the keys stop, not at each step.
  await expect.poll(() => said(page)).toEqual(['Playhead 00:00:00.005']);
  await page.keyboard.press('i');
  await expect.poll(() => said(page)).toEqual(['Playhead 00:00:00.005', 'In 00:00:00.005']);
});

test('a hub filter says how many tools it shows, not the whole list', async ({ page }) => {
  await page.goto('/photo', { waitUntil: 'networkidle' });
  const list = page.getByRole('main').getByRole('list').last();
  await expect(list).not.toHaveAttribute('aria-live');
  await page.getByRole('radio', { name: /^AI/ }).click();
  const count = await list.getByRole('listitem').count();
  await expect(page.getByRole('status').filter({ hasText: /^\d+ tools?$/ })).toHaveText(
    `${String(count)} tool${count === 1 ? '' : 's'}`,
  );
});

test('the crop box’s focus ring is the media accent on a dark band', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('/crop-image');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(FACE);
  const box = page.getByRole('group', { name: /^Crop box/ });
  await box.focus();
  await page.keyboard.press('ArrowRight');
  const ring = await box.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outline: style.outlineColor, shadow: style.boxShadow };
  });
  // --media-accent, not the page's --focus-ring (1.7:1 over the dimmed picture).
  expect(ring.outline).toBe('rgb(185, 224, 76)');
  expect(ring.shadow).toContain('rgba(10, 10, 10, 0.82) 0px 0px 0px 6px');
});

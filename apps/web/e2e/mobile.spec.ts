import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { cspViolations, expect, test } from './fixtures';

// M8 mobile polish (docs/12 → M8; docs/01 → Mobile): Android's share
// target, the install button, and the "works best on a computer" note.

const FACE = fileURLToPath(new URL('../../../fixtures/photo/face.jpg', import.meta.url));

/** A page the service worker controls, as an installed app's pages are. */
async function controlled(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** What Android's share sheet does: a multipart POST of the files to the manifest's action. */
async function share(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.id = 'share-test';
    form.method = 'post';
    form.action = '/share';
    form.enctype = 'multipart/form-data';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'files';
    input.multiple = true;
    form.append(input);
    document.body.append(form);
  });
  await page.locator('#share-test input[type=file]').setInputFiles(files);
  await Promise.all([
    page.waitForURL(/\/share\?files=\d+/),
    page.evaluate(() => {
      (document.getElementById('share-test') as HTMLFormElement).submit();
    }),
  ]);
}

const sharedCount = (page: Page) =>
  page.evaluate(async () => (await (await caches.open('etb-shared')).keys()).length);

test('the manifest offers a share target for photos, video, audio and subtitles', async ({
  request,
}) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    share_target?: { action: string; method: string; params: { files: { accept: string[] }[] } };
  };
  expect(manifest.share_target?.action).toBe('/share');
  expect(manifest.share_target?.method).toBe('POST');
  expect(manifest.share_target?.params.files[0]?.accept).toEqual(
    expect.arrayContaining(['image/*', 'video/*', 'audio/*', '.srt']),
  );
});

test('a photo shared from another app opens in the tool picked, and nothing is kept', async ({
  page,
}) => {
  await controlled(page);
  await share(page, [{ name: 'face.jpg', mimeType: 'image/jpeg', buffer: readFileSync(FACE) }]);
  await expect(page.getByRole('heading', { name: 'Open with a tool' })).toBeVisible();
  await expect(page.getByText(/^face\.jpg, [\d.]+ KB\./)).toBeVisible();
  // Read once, then gone from the device's cache.
  expect(await sharedCount(page)).toBe(0);
  // Photo tools are offered; audio ones aren't.
  await expect(page.getByRole('button', { name: 'Compress Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audio Converter', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compress Image', exact: true }).click();
  await expect(page).toHaveURL(/\/compress-image$/);
  await expect(page.getByRole('button', { name: 'Compress', exact: true })).toBeEnabled();
  // Back to /share: nothing left to open.
  await page.goto('/share');
  await expect(page.getByRole('heading', { name: 'Nothing to open' })).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('several shared files go to a tool that takes them all', async ({ page }) => {
  await controlled(page);
  const face = readFileSync(FACE);
  await share(page, [
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: face },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: face },
  ]);
  await expect(page.getByText(/^2 files, [\d.]+ KB\./)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Shared files' })).toContainText('two.jpg');
  // Only tools that take a batch: Compress Image does, Crop Image's editor doesn't.
  await expect(page.getByRole('button', { name: 'Compress Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photo Editor', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compress Image', exact: true }).click();
  await expect(page).toHaveURL(/\/compress-image$/);
  await expect(page.getByText('two.jpg').first()).toBeVisible();
});

test('the footer offers to install the app only when the browser can', async ({ page }) => {
  await page.goto('/');
  const install = page.getByRole('button', { name: 'Install the app' });
  await expect(install).toHaveCount(0);
  // What Chrome fires when the site can be installed.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { prompted: boolean }).prompted = true;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await expect(install).toBeVisible();
  await install.click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(
    true,
  );
  // One prompt per offer: the button goes.
  await expect(install).toHaveCount(0);
});

test('a tool that works best on a computer says so on a phone only', async ({ page, isMobile }) => {
  await page.goto('/batch-rename');
  const note = page.getByText('Works best on a computer, and works here too.');
  if (isMobile) await expect(note).toBeVisible();
  else await expect(note).toBeHidden();
  await page.goto('/compress-image');
  await expect(page.getByText('Works best on a computer, and works here too.')).toHaveCount(0);
});

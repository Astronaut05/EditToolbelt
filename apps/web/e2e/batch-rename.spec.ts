import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, pick, test, unzipStored } from './fixtures';

// U02 Batch Rename Files (tools/utility.md → Tests): a rule chain on 100
// names gives the expected names; clashes are flagged; the date rule uses
// the capture date. In desktop Chromium, a folder is renamed in place.

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

const text = (name: string, body = name) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(body),
});

/** A JPEG holding only an EXIF block that says it was taken at `date` ("2025:07:14 09:30:15"). */
function jpegTaken(date: string): Buffer {
  const value = Buffer.from(`${date}\0`);
  const tiff = Buffer.alloc(44 + value.length);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(value.length, 32);
  tiff.writeUInt32LE(44, 36);
  value.copy(tiff, 44);
  const app1 = Buffer.alloc(10);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(tiff.length + 8, 2);
  app1.write('Exif\0\0', 4, 'latin1');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, tiff, Buffer.from([0xff, 0xd9])]);
}

/** The settings: in place on desktop, a group's sheet on phones. */
async function settings(page: Page, isMobile: boolean, row: RegExp) {
  if (!isMobile) return page.getByRole('region', { name: 'Settings' });
  await page.getByRole('button', { name: row }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

async function closeSheet(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
}

/** The new names the list shows, in order. */
async function newNames(page: Page): Promise<string[]> {
  const rows = page.getByRole('table', { name: 'Files' }).locator('tbody tr');
  return rows.evaluateAll((all) =>
    all.map((row) => row.querySelectorAll('td')[1]?.querySelector('span')?.textContent ?? ''),
  );
}

test('a rule chain names 100 files, and the ZIP holds each one under its new name', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the long list is covered on desktop');
  await page.goto('/batch-rename');
  const files = Array.from({ length: 100 }, (_, i) =>
    text(
      i % 2 === 0 ? `IMG_${String(4000 + i)}.JPG` : `IMG_${String(4000 + i)} (copy).jpeg`,
      `file ${String(i)}`,
    ),
  );
  await fileInput(page).setInputFiles(files);
  const panel = page.getByRole('region', { name: 'Settings' });
  await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('IMG_');
  await panel.getByRole('checkbox', { name: /Brackets/ }).check();
  await panel.getByRole('textbox', { name: 'Prefix', exact: true }).fill('trip-');
  await choose(page, false, 'Counter', 'On');
  await panel.getByRole('textbox', { name: 'New extension', exact: true }).fill('jpg');
  const expected = files.map(
    (_, i) => `trip-${String(4000 + i)}_${String(i + 1).padStart(3, '0')}.jpg`,
  );
  await expect.poll(() => newNames(page)).toEqual(expected);
  await page.getByRole('button', { name: 'Rename · 100 files' }).click();
  const all = page.getByRole('button', { name: 'Download all · ZIP' });
  await expect(all).toBeEnabled({ timeout: 30_000 });
  const saved = page.waitForEvent('download');
  await all.click();
  const zip = await saved;
  expect(zip.suggestedFilename()).toBe('batch-rename.zip');
  const entries = unzipStored(readFileSync(await zip.path()));
  expect(entries.map((e) => e.name)).toEqual(expected);
  // The bytes are the files' own.
  entries.forEach((entry, i) => {
    expect(entry.data.toString()).toBe(`file ${String(i)}`);
  });
  expect(await cspViolations(page)).toEqual([]);
});

test('names that clash are flagged and stop the rename', async ({ page, isMobile }) => {
  await page.goto('/batch-rename');
  await fileInput(page).setInputFiles([text('a.JPG'), text('A.jpg'), text('b.jpg')]);
  await choose(page, isMobile, 'New extension', 'lower');
  await expect(
    page.getByText('Can’t use: Same name as another file').filter({ visible: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText(/^2 new names can’t be used/).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename · 3 files' })).toBeDisabled();
  // The list fits the screen, so nothing is pushed off it (the phone's settings sheet).
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
  // A counter makes every name different.
  await choose(page, isMobile, 'Counter', 'On');
  await expect.poll(() => newNames(page)).toEqual(['a_001.jpg', 'A_002.jpg', 'b_003.jpg']);
  await expect(page.getByRole('button', { name: 'Rename · 3 files' })).toBeEnabled();
});

test('the date rule uses when the photo was taken', async ({ page, isMobile }) => {
  await page.goto('/batch-rename');
  await fileInput(page).setInputFiles([
    { name: 'DSC_0001.jpg', mimeType: 'image/jpeg', buffer: jpegTaken('2025:07:14 09:30:15') },
    text('notes.txt'),
  ]);
  await pick(page, isMobile, 'Date', 'taken');
  const scope = await settings(page, isMobile, /^Date/);
  await scope.getByRole('combobox', { name: 'Date format' }).selectOption('YYYY-MM-DD_HH-mm-ss');
  await scope.getByRole('radio', { name: 'Instead' }).click();
  await closeSheet(page, isMobile);
  await expect.poll(async () => (await newNames(page))[0]).toBe('2025-07-14_09-30-15.jpg');
  await expect(
    page
      .getByText('No date taken in this file; its modified date is used')
      .filter({ visible: true }),
  ).toBeVisible();
});

test('a pattern that can’t be read says why', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the same settings as on desktop');
  await page.goto('/batch-rename');
  await fileInput(page).setInputFiles([text('Take_01.wav'), text('Take_02.wav')]);
  await choose(page, false, 'Match', 'Pattern');
  const panel = page.getByRole('region', { name: 'Settings' });
  await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('^Take_(\\d+');
  await expect(page.getByText(/^The pattern can’t be read/)).toBeVisible();
  await panel.getByRole('textbox', { name: 'Find', exact: true }).fill('^Take_(\\d+)$');
  await panel.getByRole('textbox', { name: 'Replace with', exact: true }).fill('shot-$1');
  await expect.poll(() => newNames(page)).toEqual(['shot-01.wav', 'shot-02.wav']);
});

test('renames a folder’s files where they are, and undoes it', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile || browserName !== 'chromium', 'folders open in desktop Chromium');
  // The folder picker can't be clicked in a test: it hands over a folder in the
  // page's private storage instead, which renames the same way.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Shoot'),
    });
  });
  await page.goto('/batch-rename');
  await page.evaluate(async () => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('Shoot', {
      create: true,
    });
    for (const name of ['1.txt', '2.txt', '3.txt', '.hidden']) {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(`was ${name}`);
      await writable.close();
    }
  });
  const folder = async () =>
    page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Shoot');
      const out: string[] = [];
      for await (const handle of (
        dir as unknown as { values(): AsyncIterable<FileSystemFileHandle> }
      ).values()) {
        out.push(`${handle.name}=${await (await handle.getFile()).text()}`);
      }
      return out.sort();
    });
  await page.getByRole('button', { name: 'Open a folder' }).click();
  // Counting from 2 moves each file onto the next one's name: they're renamed in two steps.
  await choose(page, false, 'Counter', 'On');
  const panel = page.getByRole('region', { name: 'Settings' });
  await panel.getByRole('spinbutton', { name: 'Start at' }).fill('2');
  await panel.getByRole('spinbutton', { name: 'Digits' }).fill('1');
  await choose(page, false, 'Counter goes', 'Instead');
  await expect.poll(() => newNames(page)).toEqual(['2.txt', '3.txt', '4.txt']);
  await page.getByRole('button', { name: 'Rename in “Shoot”' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename in the folder' });
  await expect(dialog).toContainText('3 files in “Shoot” get their new names.');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByText('3 files renamed in “Shoot”.', { exact: false })).toBeVisible();
  expect(await folder()).toEqual([
    '.hidden=was .hidden',
    '2.txt=was 1.txt',
    '3.txt=was 2.txt',
    '4.txt=was 3.txt',
  ]);
  await page.getByRole('button', { name: 'Undo rename' }).click();
  await expect(page.getByRole('button', { name: 'Rename in “Shoot”' })).toBeVisible();
  expect(await folder()).toEqual([
    '.hidden=was .hidden',
    '1.txt=was 1.txt',
    '2.txt=was 2.txt',
    '3.txt=was 3.txt',
  ]);
});

test('files over 2 GB in all can’t go in a ZIP, and the page says where to rename them', async ({
  page,
}) => {
  await page.goto('/batch-rename');
  // Two "1.5 GB" clips: only their sizes are read before a rename, so none is made that big.
  await fileInput(page).evaluate((input: HTMLInputElement) => {
    const files = new DataTransfer();
    for (const name of ['A001.MOV', 'A002.MOV']) {
      const file = new File(['clip'], name);
      Object.defineProperty(file, 'size', { value: 1.5 * 1024 ** 3 });
      files.items.add(file);
    }
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    page
      .getByText(/^These files come to 3 GB, and a ZIP made in the browser holds up to 2 GB\. /)
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename · 2 files' })).toBeDisabled();
});

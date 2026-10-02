import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { cspViolations, expect, pick, test } from './fixtures';

// U04 File Checksum (tools/utility.md): MD5, SHA-1 and SHA-256, streamed;
// a file checked against a pasted hash; two files compared; the list exported.

const fileInput = (page: Page) => page.locator('input[type=file][data-hydrated]').first();

const file = (name: string, buffer: Buffer) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer,
});

/** The known answers for "abc" (FIPS 180 and RFC 1321 test vectors). */
const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

/** Pastes into Expected hash: in place on desktop, in its sheet on phones. */
async function paste(page: Page, isMobile: boolean, text: string) {
  if (isMobile) await page.getByRole('button', { name: /^Expected hash/ }).click();
  const scope = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Settings' });
  await scope.getByRole('textbox', { name: 'Expected hash' }).fill(text);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(scope).toBeHidden();
  }
}

const list = (page: Page) => page.getByRole('table', { name: 'Files' });

test('"abc" gives the known MD5, SHA-1 and SHA-256, and a pasted hash is checked', async ({
  page,
  isMobile,
}) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.postDataBuffer()) sent.push(request.url());
  });
  await page.goto('/file-checksum');
  await fileInput(page).setInputFiles(file('abc.txt', Buffer.from('abc')));
  // It runs as soon as the file is in: no button to press.
  for (const hash of Object.values(ABC)) await expect(list(page)).toContainText(hash);
  await expect(page.getByRole('button', { name: 'Copy SHA-256 of abc.txt' })).toBeVisible();

  await paste(page, isMobile, ABC.sha256.toUpperCase());
  await expect(page.getByText('The hash matches: this is the same file.')).toBeVisible();
  await expect(list(page)).toContainText('Matches the SHA-256 pasted');

  // An MD5 is told apart by its length; one changed digit is a mismatch.
  await paste(page, isMobile, `${ABC.md5.slice(0, -1)}0`);
  await expect(
    page.getByText('The hash doesn’t match: this file differs from the one that was hashed.'),
  ).toBeVisible();
  await expect(list(page)).toContainText('Doesn’t match the MD5 pasted (900150983cd2…)');
  expect(sent).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test('a 48 MB file is hashed in pieces and matches Node’s own hashes', async ({ page }) => {
  // Bytes that differ all the way through, so a dropped or repeated piece would show.
  const big = Buffer.alloc(48 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 4) big.writeUInt32LE(Math.imul(i, 2654435761) >>> 0, i);
  const want = {
    md5: createHash('md5').update(big).digest('hex'),
    sha1: createHash('sha1').update(big).digest('hex'),
    sha256: createHash('sha256').update(big).digest('hex'),
  };
  await page.goto('/file-checksum');
  await fileInput(page).setInputFiles(file('clip.mov', big));
  for (const hash of Object.values(want)) {
    await expect(list(page)).toContainText(hash, { timeout: 30_000 });
  }
});

test('two copies are compared, and a list is checked file by file', async ({ page, isMobile }) => {
  const a = Buffer.from('the original take');
  const b = Buffer.from('the original takE');
  await page.goto('/file-checksum');
  await fileInput(page).setInputFiles([file('A001.mov', a), file('A001 copy.mov', a)]);
  await expect(page.getByText('The 2 files are identical.')).toBeVisible();

  await page.goto('/file-checksum');
  await fileInput(page).setInputFiles([file('A001.mov', a), file('A002.mov', b)]);
  await expect(page.getByText('The 2 files are different.')).toBeVisible();

  // A SHA256SUMS list from the shoot: A001 is right, A002's line is A001's hash.
  const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  await paste(page, isMobile, `${sha(a)}  card1/A001.mov\n${sha(a)} *A002.mov\n# made on set\n`);
  await expect(page.getByText('1 of 2 files don’t match.')).toBeVisible();
  await expect(list(page)).toContainText('Matches the SHA-256 pasted');
  await expect(list(page)).toContainText('Doesn’t match the SHA-256 pasted');
});

test('the list downloads as SHA256SUMS that sha256sum can check, or as a CSV', async ({
  page,
  isMobile,
}) => {
  const files = [
    file('A001.mov', Buffer.from('one')),
    file('A002.mov', Buffer.from('two')),
    file('=SUM(1).wav', Buffer.from('three')),
  ];
  const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  await page.goto('/file-checksum');
  await fileInput(page).setInputFiles(files);
  const download = page.getByRole('button', { name: 'Download list · SHA-256' });
  await expect(download).toBeEnabled({ timeout: 30_000 });
  let saved = page.waitForEvent('download');
  await download.click();
  let out = await saved;
  expect(out.suggestedFilename()).toBe('SHA256SUMS');
  expect(readFileSync(await out.path(), 'utf8')).toBe(
    files.map((f) => `${sha(f.buffer)}  ${f.name}\n`).join(''),
  );
  // No per-file downloads: a hash list is the result.
  await expect(page.getByRole('button', { name: /^Download A001/ })).toHaveCount(0);

  await pick(page, isMobile, 'List format', 'csv');
  saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download list · CSV' }).click();
  out = await saved;
  expect(out.suggestedFilename()).toBe('checksums.csv');
  const csv = readFileSync(await out.path(), 'utf8').split('\n');
  expect(csv[0]).toBe('file,bytes,md5,sha1,sha256');
  expect(csv[1]).toBe(
    `"A001.mov",3,${createHash('md5').update('one').digest('hex')},${createHash('sha1').update('one').digest('hex')},${sha(Buffer.from('one'))}`,
  );
  // A name a spreadsheet would run as a formula stays text.
  expect(csv[3]?.startsWith(`"'=SUM(1).wav",5,`)).toBe(true);
});

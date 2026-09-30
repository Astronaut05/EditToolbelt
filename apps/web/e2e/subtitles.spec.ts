import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { choose, expect, test } from './fixtures';

// T01 Subtitle Converter and its pair pages (tools/subtitles-and-time.md, docs/09).

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/subtitles/${name}`, import.meta.url));

test('a messy SRT becomes clean WebVTT, with a report of what changed', async ({ page }) => {
  await page.goto('/subtitle-converter');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(fixture('messy.srt'));
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  const preview = page.getByLabel('Start of messy.vtt');
  await expect(preview).toContainText('WEBVTT');
  await expect(preview).toContainText('00:00:01.500 --> 00:00:03.250');
  await expect(
    page.getByText('1 font or color tag removed').filter({ visible: true }),
  ).toBeVisible();

  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download VTT/ })
    .first()
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('messy.vtt');
  const text = readFileSync(await file.path(), 'utf8');
  expect(text.startsWith('WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nDot and comma times\n')).toBe(
    true,
  );
});

test('several files convert as a batch and download as one ZIP', async ({ page, isMobile }) => {
  await page.goto('/subtitle-converter');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles([fixture('roundtrip.srt'), fixture('features.ass'), fixture('basic.sbv')]);
  await choose(page, isMobile, 'Convert to', 'SRT');
  await page.getByRole('button', { name: 'Convert · 3 files' }).click();
  await expect(page.getByRole('button', { name: 'Download all · ZIP' }).first()).toBeEnabled();
  await expect(page.getByRole('table')).toContainText('1 style override removed');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all · ZIP' }).first().click();
  const zip = await download;
  expect(zip.suggestedFilename()).toBe('subtitle-converter.zip');
  const bytes = readFileSync(await zip.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  // Stored names, in the ZIP's local headers.
  for (const name of ['roundtrip.srt', 'features.srt', 'basic.srt']) {
    expect(bytes.includes(Buffer.from(name)), name).toBe(true);
  }
});

test('the ASS to SRT pair page is preset to SRT and has its own copy', async ({
  page,
  isMobile,
}) => {
  await page.goto('/convert/ass-to-srt');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ASS to SRT Converter');
  await expect(page.getByRole('heading', { name: 'About ASS and SRT' })).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    /\/convert\/ass-to-srt$/,
  );

  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('features.ass'));
  if (isMobile) await expect(page.getByRole('button', { name: /^Convert to.*SRT/ })).toBeVisible();
  else await expect(page.getByRole('radio', { name: 'SRT', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const preview = page.getByLabel('Start of features.srt');
  await expect(preview).toContainText('<i>Hello</i>, world.');
  await expect(preview).toContainText('00:00:01,000 --> 00:00:04,250');
});

test('the converter links to its pair pages, and they are in the sitemap', async ({
  page,
  request,
}) => {
  await page.goto('/subtitle-converter');
  const conversions = page.getByRole('region', { name: 'Conversions' });
  await expect(conversions.getByRole('link')).toHaveText([
    /SRT to VTT Converter/,
    /VTT to SRT Converter/,
    /ASS to SRT Converter/,
  ]);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/convert/srt-to-vtt');
  expect(sitemap).not.toContain('/convert/avi-to-mp4');
  expect((await request.get('/convert/avi-to-mp4')).status()).toBe(404);
});

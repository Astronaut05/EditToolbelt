import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { choose, expect, test } from './fixtures';

// T02 Subtitle Sync & Shift (tools/subtitles-and-time.md → Tests).

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/subtitles/${name}`, import.meta.url));

/** SRT start and end times in ms, in file order. */
function times(srt: string): [number, number][] {
  return [...srt.matchAll(/(\d+):(\d\d):(\d\d),(\d{3}) --> (\d+):(\d\d):(\d\d),(\d{3})/g)].map(
    (m) => {
      const n = m.slice(1).map(Number);
      const at = (i: number) =>
        (((n[i] ?? 0) * 60 + (n[i + 1] ?? 0)) * 60 + (n[i + 2] ?? 0)) * 1000 + (n[i + 3] ?? 0);
      return [at(0), at(4)];
    },
  );
}

async function sync(page: Page, format = 'SRT') {
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  const button = page.getByRole('button', { name: new RegExp(`^Download ${format}`) }).first();
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}

async function field(page: Page, isMobile: boolean, row: string, label: string, value: string) {
  if (isMobile) await page.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  const scope = isMobile ? page.getByRole('dialog', { name: 'Settings' }) : page.locator('main');
  await scope.getByLabel(label, { exact: true }).fill(value);
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(scope).toBeHidden();
  }
}

test('shifts every cue 1.25 s later, keeping the file as it was', async ({ page, isMobile }) => {
  await page.goto('/subtitle-shift');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('roundtrip.srt'));
  await expect(page.getByText(/SRT · 5 cues/).first()).toBeAttached();
  await field(page, isMobile, 'Move by', 'Move by', '1.25');
  const out = await sync(page);
  expect(out.name).toBe('roundtrip_synced.srt');
  expect(out.text).toContain('1\n00:00:02,250 --> 00:00:04,750\nRolling in three, two, one.');
  const original = times(readFileSync(fixture('roundtrip.srt'), 'utf8'));
  expect(times(out.text)).toEqual(original.map(([s, e]) => [s + 1250, e + 1250]));
});

test('two-point sync restores a late, drifting file to within 10 ms', async ({
  page,
  isMobile,
}) => {
  await page.goto('/subtitle-shift');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('drifted.srt'));
  await choose(page, isMobile, 'Fix', 'Two points');
  // The pickers start on the first and last cue, at their current times.
  await field(page, isMobile, 'First cue', 'First cue at', '00:00:01,000');
  await field(
    page,
    isMobile,
    isMobile ? 'Second cue' : 'Second cue',
    'Second cue at',
    '1:00:02.100',
  );
  const out = await sync(page);
  const truth = times(readFileSync(fixture('roundtrip.srt'), 'utf8'));
  const fixed = times(out.text);
  expect(fixed).toHaveLength(truth.length);
  fixed.forEach(([start, end], i) => {
    expect(Math.abs(start - (truth[i]?.[0] ?? 0))).toBeLessThanOrEqual(10);
    expect(Math.abs(end - (truth[i]?.[1] ?? 0))).toBeLessThanOrEqual(10);
  });
  await expect(page.getByText(/offset −2\.50\d s, drift/).first()).toBeAttached();
});

test('an ASS file stays ASS, with its styles', async ({ page, isMobile }) => {
  await page.goto('/subtitle-shift');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles(fixture('features.ass'));
  await field(page, isMobile, 'Move by', 'Move by', '-0.5');
  const out = await sync(page, 'ASS');
  expect(out.name).toBe('features_synced.ass');
  expect(out.text).toContain('[V4+ Styles]');
  expect(out.text).toContain('Dialogue: 0,0:00:00.50,0:00:03.75,Default,Anna');
});

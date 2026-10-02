import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// T03 Subtitle Editor (tools/subtitles-and-time.md): an SRT with a long line,
// a gap too small and an overlap is fixed from the checks, edited in the list,
// found and replaced, merged (with undo and redo), nudged on the timeline by
// the keyboard, and saved as WebVTT, checked byte for byte.

const SRT = `1
00:00:01,000 --> 00:00:03,000
Hello there, this line is definitely much too long for a single subtitle line

2
00:00:03,040 --> 00:00:05,000
Second cue

3
00:00:04,500 --> 00:00:06,000
Third overlaps

4
00:00:08,000 --> 00:00:10,000
The cat sat
`;

const checks = (page: Page) => page.getByRole('region', { name: 'Checks' });
const cueCount = (page: Page) => page.getByRole('list', { name: 'Cues' }).getByRole('listitem');

test('fix, edit, find and replace, merge, nudge, and save as WebVTT', async ({
  page,
  isMobile,
}) => {
  await page.goto('/subtitle-editor');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'film.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from(SRT),
    });
  await expect(page.getByText('SRT · 4 cues · 0:10').filter({ visible: true })).toBeVisible();
  await expect(cueCount(page)).toHaveCount(4);

  // The checks: 77 characters on a line, 40 ms before the next cue, an overlap.
  await expect(checks(page)).toContainText('Lines too long: 1');
  await expect(checks(page)).toContainText('Gaps too small: 1');
  await expect(checks(page)).toContainText('Overlaps: 1');
  await expect(page.getByText('77 characters on a line (42 at most)')).toBeVisible();
  await checks(page).getByRole('button', { name: 'Fix all lines too long' }).click();
  await expect(page.getByRole('textbox', { name: 'Cue 1 text' })).toHaveValue(
    'Hello there, this line is definitely\nmuch too long for a single subtitle line',
  );
  await checks(page).getByRole('button', { name: 'Fix all overlaps' }).click();
  await expect(page.getByRole('textbox', { name: 'Cue 2 end' })).toHaveValue('00:00:04.417');
  await checks(page).getByRole('button', { name: 'Fix all gaps too small' }).click();
  await expect(page.getByRole('textbox', { name: 'Cue 1 end' })).toHaveValue('00:00:02.957');
  await expect(checks(page)).not.toContainText('Overlaps');

  // Typing, then find and replace across the file.
  await page.getByRole('textbox', { name: 'Cue 4 text' }).fill('The dog sat on the mat');
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('dog');
  await expect(page.getByText('1 found')).toBeVisible();
  await page.getByRole('textbox', { name: 'Replace with' }).fill('cat');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Replaced 1 match' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Cue 4 text' })).toHaveValue(
    'The cat sat on the mat',
  );

  // Merge cues 2 and 3, undo it, redo it.
  await page.getByRole('button', { name: 'Play from cue 2' }).click();
  await page.getByRole('button', { name: 'Merge with next' }).click();
  await expect(cueCount(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cueCount(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(cueCount(page)).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'Cue 2 text' })).toHaveValue(
    'Second cue\nThird overlaps',
  );

  // On the timeline, the right arrow moves the last cue 0.1 s later.
  await page.getByRole('button', { name: /^Cue 3: 00:00:08\.000 to 00:00:10\.000/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('textbox', { name: 'Cue 3 start' })).toHaveValue('00:00:08.100');

  await choose(page, isMobile, 'Save as', 'VTT');
  await page.getByRole('button', { name: 'Save subtitles', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe('film_edited.vtt');
  expect(readFileSync(await file.path(), 'utf8')).toBe(
    [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.957',
      'Hello there, this line is definitely',
      'much too long for a single subtitle line',
      '',
      '00:00:03.040 --> 00:00:06.000',
      'Second cue',
      'Third overlaps',
      '',
      '00:00:08.100 --> 00:00:10.100',
      'The cat sat on the mat',
      '',
    ].join('\n'),
  );

  // Once saved, an edit is saved again by itself.
  await page.getByRole('textbox', { name: 'Cue 3 text' }).fill('The end');
  await expect(async () => {
    const again = page.waitForEvent('download');
    await page
      .getByRole('button', { name: /^Download/ })
      .first()
      .click();
    const text = readFileSync(await (await again).path(), 'utf8');
    expect(text).toContain('00:00:08.100 --> 00:00:10.100\nThe end\n');
  }).toPass({ timeout: 10_000 });
  expect(await cspViolations(page)).toEqual([]);
});

/** `seconds` of silence as a mono 16-bit WAV at 8 kHz: something to play along. */
function silence(seconds: number): Buffer {
  const bytes = seconds * 8000 * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

test('the audio picked plays along: a cue takes the player to its start', async ({
  page,
  isMobile,
}) => {
  await page.goto('/subtitle-editor');
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({
      name: 'film.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from(SRT),
    });
  await expect(cueCount(page)).toHaveCount(4);
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  if (isMobile) await page.getByRole('button', { name: /^Save as/ }).click();
  await (isMobile ? sheet : page.getByRole('region', { name: 'Settings' }))
    .locator('input[type=file][aria-label="Video or audio"]')
    .setInputFiles({ name: 'film.wav', mimeType: 'audio/wav', buffer: silence(12) });
  if (isMobile) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  const audio = page.getByLabel('Audio', { exact: true });
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeCloseTo(12, 1);
  // From a cue in the list, and from its block on the timeline.
  await page.getByRole('button', { name: 'Play from cue 4' }).click();
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeCloseTo(8, 1);
  await page.getByRole('button', { name: /^Cue 2: / }).click();
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeCloseTo(3.04, 1);
  await expect(page.getByText(/^Playhead 00:00:03\.040/i)).toBeVisible();
});

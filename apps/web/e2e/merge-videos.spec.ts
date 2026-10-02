import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { probeMedia, trackEnds, videoPackets } from '@etb/engines';
import type { Page } from '@playwright/test';

import { choose, cspViolations, expect, test } from './fixtures';

// V12 Merge Videos (tools/video.md → Tests): identical clips join without a
// re-encode to the exact total length; mixed 30 and 25 fps clips come out
// on one constant 30 fps clock. Outputs are read back in Node with the
// engine's own probe. Playwright's Chromium has no H.264 encoder, so the
// clips are VP9.

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/video/${name}`, import.meta.url));
const MKV = fixture('clip-vp9-opus.mkv');
const FPS25 = fixture('clip-vp9-25fps.webm');
const MOV = fixture('clip-h264-aac.mov');

const MIME: Record<string, string> = {
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const asFile = (path: string, name: string) => ({
  name,
  mimeType: MIME[path.split('.').pop() ?? ''] ?? 'video/webm',
  buffer: readFileSync(path),
});

async function drop(page: Page, files: ReturnType<typeof asFile>[]) {
  await page.goto('/merge-videos');
  await page.locator('input[type=file][data-hydrated]').first().setInputFiles(files);
  await expect(page.getByRole('list', { name: 'Files, in order' }).getByText(/fps/)).toHaveCount(
    files.length,
  );
}

async function merged(page: Page) {
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  await expect(button).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForEvent('download');
  await button.click();
  const file = await saved;
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('three identical clips join without a re-encode, to the exact total', async ({ page }) => {
  await drop(page, [asFile(MKV, 'a.mkv'), asFile(MKV, 'b.mkv'), asFile(MKV, 'c.mkv')]);
  const out = await merged(page);
  expect(out.name).toBe('a_merged.mkv');
  // Three 4 s clips of 120 frames each, back to back.
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - 12)).toBeLessThan(0.05);
  // Every video packet is a source packet, byte for byte, three times over.
  const source = await videoPackets(new Blob([readFileSync(MKV)]));
  const packets = await videoPackets(new Blob([out.bytes]));
  expect(packets.length).toBe(3 * source.length);
  expect(
    packets.every((p, i) => Buffer.from(p).equals(Buffer.from(source[i % source.length] ?? []))),
  ).toBe(true);
  await expect(
    page
      .getByText(/every packet is copied/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('five H.264 + AAC clips join without a re-encode, the sound still with the picture', async ({
  page,
}) => {
  // Each clip's AAC has a priming packet before 0 and runs 10.7 ms past its
  // 4 s picture: placed whole, each join would make the sound 32 ms later.
  await drop(
    page,
    ['a', 'b', 'c', 'd', 'e'].map((name) => asFile(MOV, `${name}.mov`)),
  );
  const out = await merged(page);
  expect(out.name).toBe('a_merged.mov');
  const ends = await trackEnds(new Blob([out.bytes]));
  expect(Math.abs(ends.video - 20)).toBeLessThan(0.001);
  expect(Math.abs((ends.audio ?? 0) - ends.video)).toBeLessThan(0.04);
  await expect(
    page
      .getByText(/every packet is copied/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});

test('30 and 25 fps clips come out at the first clip’s size on a steady 30 fps', async ({
  page,
}) => {
  await drop(page, [asFile(MKV, 'thirty.mkv'), asFile(FPS25, 'twentyfive.webm')]);
  const out = await merged(page);
  expect(out.name).toBe('thirty_merged.mkv');
  const info = await probeMedia(new Blob([out.bytes]));
  expect(info.video).toMatchObject({ width: 256, height: 144, fps: 30, variableFrameRate: false });
  // 4 s + 4.008 s, each on whole frames at 30 fps: 240 frames, 8 s, no drift.
  expect(Math.abs(info.durationSec - 8)).toBeLessThan(1 / 30 + 0.03);
  expect((await videoPackets(new Blob([out.bytes]))).length).toBe(240);
  expect(info.audio[0]?.codec).toBe('opus');
});

test('a 1 s crossfade overlaps two clips by a second', async ({ page, isMobile }) => {
  await drop(page, [asFile(MKV, 'one.mkv'), asFile(MKV, 'two.mkv')]);
  // 1 s is the default length.
  await choose(page, isMobile, 'Between clips', 'Crossfade');
  const out = await merged(page);
  const info = await probeMedia(new Blob([out.bytes]));
  expect(Math.abs(info.durationSec - 7)).toBeLessThan(1 / 30 + 0.03);
  await expect(
    page.getByText(/2 clips joined with 1\.00 s crossfades/).filter({ visible: true }),
  ).toBeVisible();
});

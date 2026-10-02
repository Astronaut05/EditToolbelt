import { cspViolations, expect, test } from './fixtures';

// T07 Shutter Angle and T08 Recording Storage (tools/subtitles-and-time.md,
// Wave 3): live results as you type, state in the URL.

test('shutter: 180° at 24 fps is 1/48, and 1/50 is the flicker-safe neighbour', async ({
  page,
}) => {
  await page.goto('/shutter-angle-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('1/48');
  await expect(results).toContainText('Natural, film-like motion blur');
  // 1/48 spans 2.08 pulses of 50 Hz light: not safe. 1/50 (172.8°) is.
  await expect(results).toContainText('This speed may flicker');
  const safe = results.getByRole('table');
  await expect(safe).toContainText('1/50 s');
  await expect(safe).toContainText('172.8°');

  await page.getByRole('radio', { name: 'Speed to angle' }).click();
  await page.getByRole('textbox', { name: 'Shutter speed', exact: true }).fill('1/50');
  await expect(results).toContainText('172.8');
  await expect(results).toContainText('This speed spans whole pulses');
  await expect(page).toHaveURL(/mode=speed/);

  // 30 fps under 60 Hz: every frame starts at the same point of the light.
  await page.getByRole('button', { name: '30', exact: true }).click();
  await page.getByRole('radio', { name: '60 Hz' }).click();
  await expect(results).toContainText('no speed flickers');

  // A speed longer than a frame is flagged, not guessed.
  await page.getByRole('textbox', { name: 'Shutter speed', exact: true }).fill('1/10');
  await expect(results.getByRole('alert')).toContainText('Longer than a frame');
  expect(await cspViolations(page)).toEqual([]);
});

test('shutter: 23.976 is the exact NTSC rate', async ({ page }) => {
  await page.goto('/shutter-angle-calculator?fps=23.976');
  await expect(page.getByRole('region', { name: 'Results' })).toContainText('1/47.95');
});

test('storage: 22 hours of 100 Mbps 4K on 1 TB, and what a shoot needs', async ({ page }) => {
  await page.goto('/storage-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('22 h 13 min');

  await page.getByRole('button', { name: 'Use ProRes 422 HQ, UHD 29.97p' }).click();
  await expect(page.getByRole('textbox', { name: 'Bitrate', exact: true })).toHaveValue('707');
  await expect(results).toContainText('3 h 8 min');

  // Typing the camera's own bitrate makes it "My own bitrate".
  await page.getByRole('textbox', { name: 'Bitrate', exact: true }).fill('220');
  await expect(page.getByRole('combobox', { name: 'Camera codec' })).toHaveValue('custom');

  await page.getByRole('radio', { name: 'Space needed' }).click();
  await page.getByRole('textbox', { name: 'Recording', exact: true }).fill('3');
  await expect(results).toContainText('297 GB');
  await expect(results).toContainText('594 GB');
  await expect(page).toHaveURL(/mode=space/);
  await page.reload();
  await expect(results).toContainText('297 GB');
});

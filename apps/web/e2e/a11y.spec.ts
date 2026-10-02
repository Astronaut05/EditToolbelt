import { expect, PAGES, remote, seriousViolations, test, WORKSHOP_ONLY } from './fixtures';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const { name, path } of PAGES) {
      test(`${name}: no serious issues`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        expect(await seriousViolations(page)).toEqual([]);
      });
    }

    test('search overlay: no serious issues', async ({ page, isMobile }) => {
      await page.goto('/photo', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByRole('combobox', { name: 'Search tools' }).fill('gif');
      await expect(page.getByRole('option').first()).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      if (isMobile) return;
    });

    test('crop editor with an image: no serious issues', async ({ page }) => {
      await page.goto('/crop-image', { waitUntil: 'networkidle' });
      const sample = await page.request.get('/samples/mug.jpg');
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: await sample.body() });
      await expect(page.getByRole('group', { name: /^Crop box/ })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('social sizes and focal point: no serious issues', async ({ page }) => {
      await page.goto('/social-media-image-resizer', { waitUntil: 'networkidle' });
      const sample = await page.request.get('/samples/mug.jpg');
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: await sample.body() });
      await expect(page.getByRole('application', { name: /^Focal point/ })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('rename list with a clash, and the watermark grid: no serious issues', async ({
      page,
      isMobile,
    }) => {
      await page.goto('/batch-rename', { waitUntil: 'networkidle' });
      const file = (name: string) => ({
        name,
        mimeType: 'text/plain',
        buffer: Buffer.from(name),
      });
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles([file('a.txt'), file('A.TXT'), file('b.txt')]);
      await expect(page.getByText(/^Can’t use: /).first()).toBeAttached();
      expect(await seriousViolations(page)).toEqual([]);
      await page.goto('/watermark-image', { waitUntil: 'networkidle' });
      const sample = await page.request.get('/samples/mug.jpg');
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: await sample.body() });
      // On phones the grid is in its settings sheet.
      if (isMobile) await page.getByRole('button', { name: /^Position/ }).click();
      await expect(page.getByRole('radiogroup', { name: 'Position' })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('merge list with files: no serious issues', async ({ page }) => {
      await page.goto('/merge-audio', { waitUntil: 'networkidle' });
      // Two tiny silent WAVs: a list to check, nothing to decode at length.
      const silent = () => {
        const wav = Buffer.alloc(44 + 4800 * 2);
        wav.write('RIFF', 0);
        wav.writeUInt32LE(36 + 4800 * 2, 4);
        wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(48_000, 24);
        wav.writeUInt32LE(96_000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write('data', 36);
        wav.writeUInt32LE(4800 * 2, 40);
        return wav;
      };
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles([
          { name: 'one.wav', mimeType: 'audio/wav', buffer: silent() },
          { name: 'two.wav', mimeType: 'audio/wav', buffer: silent() },
        ]);
      await expect(
        page.getByRole('list', { name: 'Files, in order' }).getByText(/48 kHz/),
      ).toHaveCount(2);
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('loudness meter result with its graph: no serious issues', async ({ page }) => {
      await page.goto('/loudness-meter', { waitUntil: 'networkidle' });
      const rate = 48_000;
      const frames = rate * 6;
      const wav = Buffer.alloc(44 + frames * 2);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(36 + frames * 2, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(rate, 24);
      wav.writeUInt32LE(rate * 2, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(frames * 2, 40);
      for (let i = 0; i < frames; i += 1) {
        wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 4000), 44 + i * 2);
      }
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
      await expect(page.getByRole('img', { name: /^Short-term loudness/ })).toBeVisible({
        timeout: 30_000,
      });
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('remove background result and refine brush: no serious issues', async ({ page }) => {
      await page.goto('/remove-background', { waitUntil: 'networkidle' });
      const sample = await page.request.get('/samples/mug.jpg');
      await page
        .locator('input[type=file][data-hydrated]')
        .first()
        .setInputFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: await sample.body() });
      await expect(page.getByRole('button', { name: 'Start over' }).first()).toBeVisible({
        timeout: 60_000,
      });
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Refine by hand' }).click();
      await expect(page.getByRole('toolbar', { name: 'Refine brush' })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('tool shell demo: no serious issues', async ({ page }) => {
      test.skip(remote, WORKSHOP_ONLY);
      await page.goto('/workshop/screens/tool-result', { waitUntil: 'networkidle' });
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

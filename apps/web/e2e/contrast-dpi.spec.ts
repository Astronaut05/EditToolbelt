import { expect, test } from './fixtures';

// C04 Contrast Checker (tools/color.md) and U03 Print Size & DPI Calculator
// (tools/utility.md): live results, state in the URL.

test('contrast: #777 on white fails AA, and the nearest pass is #767676', async ({ page }) => {
  await page.goto('/contrast-checker');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('4.47:1');
  await expect(
    results.getByRole('listitem').filter({ hasText: /^AA · normal text/ }),
  ).toContainText('Fail');
  await expect(results.getByRole('listitem').filter({ hasText: /^AA · large text/ })).toContainText(
    'Pass',
  );
  const fix = results.getByRole('listitem').filter({ hasText: 'Text color #767676' });
  await expect(fix).toContainText('4.54:1');
  await fix.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('textbox', { name: 'Text color', exact: true })).toHaveValue(
    '#767676',
  );
  await expect(results).toContainText('Passes');
  await expect(page).toHaveURL(/t=%23767676/);

  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('black');
  await expect(results).toContainText('21.00:1');
  await page.getByRole('button', { name: 'Swap text and background' }).click();
  await expect(page.getByRole('textbox', { name: 'Background color', exact: true })).toHaveValue(
    'black',
  );
  await expect(results).toContainText('21.00:1');

  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('nope');
  await expect(results.getByRole('alert')).toContainText('Text color');
});

test('contrast: AAA aims higher, and the suggestion keeps the hue', async ({ page }) => {
  await page.goto('/contrast-checker?t=%23ff6347&aim=aaa');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(page.getByRole('radio', { name: 'AAA' })).toBeChecked();
  await expect(results).toContainText('Nearest that passes AAA, normal text');
  const fix = results.getByRole('listitem').filter({ hasText: 'Text color #' });
  const ratio = Number(/(\d+\.\d+):1/.exec((await fix.textContent()) ?? '')?.[1]);
  expect(ratio).toBeGreaterThanOrEqual(7);
});

test('DPI: 3000 × 2000 at 300 DPI prints 25.4 × 16.93 cm', async ({ page }) => {
  await page.goto('/dpi-calculator');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results).toContainText('25.4 × 16.93');
  await expect(results).toContainText('10 × 6.67');
  await expect(results.getByRole('listitem').filter({ hasText: 'At 300 DPI' })).toContainText('A5');

  await page.getByRole('radio', { name: 'Pixels needed' }).click();
  await page.getByRole('combobox', { name: 'Paper' }).selectOption('a4');
  await expect(results).toContainText('2,480 × 3,508');

  await page.getByRole('radio', { name: 'DPI of a print' }).click();
  await page.getByRole('textbox', { name: 'Width', exact: true }).fill('1240');
  await page.getByRole('textbox', { name: 'Height', exact: true }).fill('1754');
  await expect(results).toContainText('150');
  await expect(results).toContainText('Fine at arm’s length');
});

test('DPI: an image fills in its pixel size without leaving the page', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    // Link prefetches are HEAD; anything carrying a body would be the file.
    if (!['GET', 'HEAD'].includes(request.method()))
      sent.push(
        `${request.method()} ${request.url()} ${String(request.postDataBuffer()?.length ?? 0)}`,
      );
  });
  await page.goto('/dpi-calculator');
  // A 640 × 480 PNG, made on the page.
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(640, 480);
    canvas.getContext('2d')?.fillRect(0, 0, 10, 10);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Use an image’s size' }).click();
  await (
    await chooser
  ).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('640');
  await expect(page.getByRole('textbox', { name: 'Height', exact: true })).toHaveValue('480');
  expect(sent).toEqual([]);
});

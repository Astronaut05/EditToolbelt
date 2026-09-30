import { expect, test } from './fixtures';

test.describe('keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop keyboard');

  test('/ opens search anywhere, and focuses the home search on home', async ({ page }) => {
    await page.goto('/photo', { waitUntil: 'networkidle' });
    await page.keyboard.press('/');
    const input = page.getByRole('combobox', { name: 'Search tools' });
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('body').click({ position: { x: 5, y: 700 } });
    await page.keyboard.press('/');
    await expect(page.locator('#home-search')).toBeFocused();
  });

  test('the first Tab reaches the skip link, which moves to main', async ({ page }) => {
    await page.goto('/photo');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('Esc cancels a running job', async ({ page }) => {
    await page.goto('/workshop/tools/form', { waitUntil: 'networkidle' });
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'song.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.alloc(4000),
      });
    await page.getByRole('button', { name: 'Normalize audio' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('progressbar')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Drop an audio file here' })).toBeVisible();
  });

  test('segmented controls move with arrow keys', async ({ page }) => {
    await page.goto('/photo', { waitUntil: 'networkidle' });
    const all = page.getByRole('radio', { name: /^All/ });
    await all.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: /^In browser/ })).toBeFocused();
    await expect(page.getByRole('radio', { name: /^In browser/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

import { expect, test } from './fixtures';

// An open tab after a deploy, or a dropped connection: a part of the page
// that loads on first use can't be fetched any more. The page says so and
// offers a reload (src/app/error.tsx), not Next's bare "Application error".

test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'once is enough');
// The service worker would fetch for the page, past the block below.
test.use({ serviceWorkers: 'block' });

test('a part of the page that fails to load ends in the error page, with Reload', async ({
  page,
}) => {
  await page.goto('/crop-image', { waitUntil: 'networkidle' });
  const sample = await page.request.get('/samples/mug.jpg');
  // From here on no script loads: the editor's code is fetched when a file arrives.
  await page.route(/\.js(\?|$)/, (route) => route.abort());
  await page
    .locator('input[type=file][data-hydrated]')
    .first()
    .setInputFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: await sample.body() });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Something went wrong on this page' }),
  ).toBeVisible();
  // Reload gets the page back, whole.
  await page.unroute(/\.js(\?|$)/);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Crop/ })).toBeVisible();
  await expect(page.locator('input[type=file][data-hydrated]').first()).toBeAttached();
});

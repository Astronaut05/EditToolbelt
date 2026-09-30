import { expect, test } from './fixtures';

test.describe('site', () => {
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'crawl once');

  test('every internal link resolves', async ({ request }) => {
    const seen = new Set<string>(['/']);
    const queue = ['/'];
    const broken: string[] = [];
    while (queue.length > 0) {
      const path = queue.shift() ?? '/';
      const response = await request.get(path);
      if (response.status() !== 200) {
        broken.push(`${path} → ${String(response.status())}`);
        continue;
      }
      if (!(response.headers()['content-type'] ?? '').includes('text/html')) continue;
      const html = await response.text();
      for (const match of html.matchAll(/<a[^>]+href="(\/[^"#?]*)/g)) {
        const href = match[1];
        if (!href || href.startsWith('/workshop') || seen.has(href)) continue;
        seen.add(href);
        queue.push(href);
      }
    }
    expect(broken).toEqual([]);
    // Home, 6 hubs, legal and info pages; soon tools are reached through search, not links.
    expect(seen.size).toBeGreaterThan(15);
  });

  test('all 75 tool pages exist, noindex while soon', async ({ request }) => {
    const index = (await (await request.get('/search-index.json')).json()) as {
      path: string;
      soon: boolean;
    }[];
    expect(index).toHaveLength(75);
    for (const entry of index) {
      const html = await (await request.get(entry.path)).text();
      expect(html, entry.path).toContain(entry.soon ? 'noindex' : '<h1');
    }
  });

  test('theme choice persists across reloads', async ({ page }) => {
    await page.goto('/photo');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('each ToolShell demo runs to a result', async ({ page }) => {
    const cases = [
      { type: 'form', file: 'a.mp3', mime: 'audio/mpeg', run: 'Normalize audio' },
      { type: 'timeline', file: 'a.mp4', mime: 'video/mp4', run: 'Trim video' },
      { type: 'analyzer', file: 'a.mp3', mime: 'audio/mpeg' },
      { type: 'canvas-editor', file: 'a.png', mime: 'image/png', run: 'Crop image' },
    ];
    for (const item of cases) {
      await page.goto(`/workshop/tools/${item.type}`, { waitUntil: 'networkidle' });
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles({ name: item.file, mimeType: item.mime, buffer: Buffer.alloc(3000) });
      if (item.run) await page.getByRole('button', { name: item.run }).click();
      await expect(page.locator('main'), item.type).toContainText(
        item.type === 'analyzer' ? 'Tempo' : 'Download',
        {
          timeout: 5000,
        },
      );
    }
  });
});

/**
 * API keys (docs/06 → Auth): made in account settings and shown once, sent as
 * `Authorization: Bearer` from anywhere, held to their scopes, revoked from
 * the same page. The `request` fixture has no cookies: only the key speaks.
 */
import AxeBuilder from '@axe-core/playwright';
import { apiKeys, eq } from '@etb/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { closeTestDb, newEmail, setScheme, signIn, testDb } from './helpers';

const db = testDb();

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await closeTestDb();
});

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

/** Makes a key on the account page; `scopes` unticks the rest. */
async function makeKey(page: Page, name: string, scopes?: string[]): Promise<string> {
  await page.goto('/account#api-keys');
  await page.getByLabel('Key name').fill(name);
  if (scopes) {
    for (const box of await page.getByRole('checkbox', { name: /:/ }).all()) {
      const scope = await box.getAttribute('value');
      await box.setChecked(scopes.includes(scope ?? ''));
    }
  }
  await page.getByRole('button', { name: 'Make a key' }).click();
  const shown = page.getByTestId('new-api-key');
  await expect(shown).toHaveText(/^etb_live_[0-9A-Za-z]{32}$/);
  return (await shown.textContent()) ?? '';
}

async function me(request: APIRequestContext, key: string) {
  return request.get('/api/v1/me', { headers: bearer(key) });
}

test('a key made in settings is shown once and works from any origin', async ({
  page,
  request,
}) => {
  const email = newEmail();
  await signIn(page, email);
  const key = await makeKey(page, 'Render script');

  // The list names it by prefix; the key itself is never on the page again.
  await page.reload();
  const list = page.getByRole('list', { name: 'Your API keys' });
  await expect(list.getByText('Render script')).toBeVisible();
  await expect(list.getByText(`${key.slice(0, 17)}…`)).toBeVisible();
  await expect(list).toContainText('never used');
  expect(await page.content()).not.toContain(key);

  const answer = await request.get('/api/v1/me', {
    headers: { ...bearer(key), Origin: 'https://someone-elses.example' },
  });
  expect(answer.status()).toBe(200);
  expect(answer.headers()['access-control-allow-origin']).toBe('*');
  expect(answer.headers()['access-control-allow-credentials']).toBeUndefined();
  expect(answer.headers()['ratelimit-limit']).toBe('120');
  expect(await answer.json()).toMatchObject({ email });

  // Writes from another origin are fine with a key (the cookie's same-origin rule is for cookies).
  const jobs = await request.post('/api/v1/jobs/quote', {
    headers: { ...bearer(key), Origin: 'https://someone-elses.example' },
    data: { tool_id: 'compress-video', upload_id: crypto.randomUUID(), options: {} },
  });
  expect(jobs.status()).not.toBe(401);
  expect(jobs.status()).not.toBe(403);

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.prefix, key.slice(0, 17)));
  expect(row?.lastUsedAt).not.toBeNull();
  expect(row?.hash).not.toContain(key.slice(9));
  await page.reload();
  await expect(list).toContainText('last used');
});

test('a key does only what its scopes allow', async ({ page, request }) => {
  await signIn(page, newEmail());
  const key = await makeKey(page, 'Status board', ['jobs:read']);

  expect((await request.get('/api/v1/jobs', { headers: bearer(key) })).status()).toBe(200);

  const balance = await me(request, key);
  expect(balance.status()).toBe(403);
  expect(await balance.json()).toMatchObject({ code: 'FORBIDDEN', detail: /account:read/ });

  const upload = await request.post('/api/v1/uploads', {
    headers: bearer(key),
    data: { tool_id: 'compress-video', bytes: 1000, mime: 'video/mp4' },
  });
  expect(upload.status()).toBe(403);
  expect(await upload.json()).toMatchObject({ code: 'FORBIDDEN', detail: /jobs:write/ });
});

test('a wrong or revoked key is refused, and preflights are answered', async ({
  page,
  request,
}) => {
  const wrong = await me(request, `etb_live_${'x'.repeat(32)}`);
  expect(wrong.status()).toBe(401);
  expect(wrong.headers()['www-authenticate']).toBe('Bearer');
  expect(await wrong.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  expect((await me(request, 'not-a-key')).status()).toBe(401);

  const preflight = await request.fetch('/api/v1/jobs', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://someone-elses.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key',
    },
  });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-origin']).toBe('*');
  expect(preflight.headers()['access-control-allow-headers']).toMatch(/Authorization/);
  expect(preflight.headers()['access-control-allow-headers']).toMatch(/Idempotency-Key/);

  await signIn(page, newEmail());
  const key = await makeKey(page, 'Old laptop');
  expect((await me(request, key)).status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'Revoke Old laptop' }).click();
  await expect(page.getByRole('status')).toHaveText(/revoked/);
  await expect(page.getByRole('list', { name: 'Your API keys' })).toHaveCount(0);
  expect((await me(request, key)).status()).toBe(401);
});

test('the account page passes axe with a new key and the list on it', async ({ page }) => {
  await signIn(page, newEmail());
  await makeKey(page, 'Axe check');
  await makeKey(page, 'Second key');
  // The action's refresh streams the page back in, its <title> after the body. The old title
  // is still there until the refreshed list is in, so wait for the list, then for the title,
  // or axe can land while the title is being swapped.
  await expect(page.getByRole('list', { name: 'Your API keys' })).toContainText('Second key');
  await expect(page).toHaveTitle(/Your account/);
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await setScheme(page, scheme);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const violation of results.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') {
        found.push(
          `${scheme} ${violation.id}: ${violation.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        );
      }
    }
  }
  expect(found).toEqual([]);
});

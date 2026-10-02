/**
 * The API's description against the API (docs/06 → Basics): the OpenAPI
 * document is served, `/developers` lists every endpoint, and real answers
 * parse with the same schemas the document is made from.
 */
import { createHash, randomBytes } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import {
  CreditList,
  DeviceCode,
  ENDPOINTS,
  JobList,
  Me,
  Problem,
  ToolDetail,
  ToolList,
  Upload,
} from '@etb/core/api';
import { apiKeys, applyCredit, toolFlags, users } from '@etb/db';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { z } from 'zod';

import { closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db
    .insert(toolFlags)
    .values({ toolId: 'compress-video', serverEnabled: true })
    .onConflictDoUpdate({ target: toolFlags.toolId, set: { serverEnabled: true } });
});

// The switch stays on (see jobs.spec.ts).
test.afterAll(async () => {
  await closeTestDb();
});

/** Fails with the first mismatch, so a drift names its field. */
async function expectShape<S extends z.ZodType>(
  answer: Awaited<ReturnType<APIRequestContext['get']>>,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await answer.json());
  expect(parsed.error?.issues ?? []).toEqual([]);
  return parsed.data as z.output<S>;
}

/** A key for a fresh account, straight into the database. */
async function keyFor(email: string): Promise<string> {
  const [user] = await db.insert(users).values({ email, emailVerified: true }).returning();
  if (!user) throw new Error('no user');
  await applyCredit(db, user.id, 'welcome_grant', 30);
  // 32 hex characters: letters and digits, as a key's body is.
  const key = `etb_live_${randomBytes(16).toString('hex')}`;
  await db.insert(apiKeys).values({
    userId: user.id,
    name: 'contract test',
    prefix: key.slice(0, 17),
    hash: createHash('sha256').update(key).digest('hex'),
    scopes: ['jobs:read', 'jobs:write', 'account:read'],
  });
  return key;
}

test('the OpenAPI document is served and names this server', async ({ request }) => {
  const answer = await request.get('/api/v1/openapi.json');
  expect(answer.status()).toBe(200);
  expect(answer.headers()['access-control-allow-origin']).toBe('*');
  const doc = (await answer.json()) as {
    openapi: string;
    servers: { url: string }[];
    paths: Record<string, unknown>;
  };
  expect(doc.openapi).toMatch(/^3\.1\./);
  expect(doc.servers[0]?.url).toMatch(/\/api\/v1$/);
  expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/jobs', '/uploads']));
});

test('answers match the schemas the document is made from', async ({ request }) => {
  const tools = await expectShape(await request.get('/api/v1/tools'), ToolList);
  expect(tools.tools.find((tool) => tool.id === 'compress-video')?.server).toBe(true);
  expect(tools.tools.find((tool) => tool.id === 'trim-video')?.server).toBe(false);

  const compress = await expectShape(await request.get('/api/v1/tools/compress-video'), ToolDetail);
  expect(compress.options).toMatchObject({
    type: 'object',
    properties: { mode: { enum: ['size', 'quality'] }, codec: expect.any(Object) as unknown },
  });
  const burn = await expectShape(await request.get('/api/v1/tools/burn-subtitles'), ToolDetail);
  expect(burn.extra_uploads).toEqual(['subtitles']);
  const merge = await expectShape(await request.get('/api/v1/tools/merge-videos'), ToolDetail);
  expect(merge.extra_uploads).toEqual(['clips']);
  expect(merge.options).toMatchObject({
    properties: { clips: { type: 'array', minItems: 1, maxItems: 19 } },
  });
  const browserOnly = await expectShape(await request.get('/api/v1/tools/trim-video'), ToolDetail);
  expect(browserOnly.options).toBeNull();
  const missing = await request.get('/api/v1/tools/no-such-tool');
  expect(missing.status()).toBe(404);
  await expectShape(missing, Problem);

  const key = await keyFor(newEmail());
  const headers = { Authorization: `Bearer ${key}` };
  const me = await expectShape(await request.get('/api/v1/me', { headers }), Me);
  expect(me.credit_balance).toBe(30);
  const credits = await expectShape(
    await request.get('/api/v1/me/credits', { headers }),
    CreditList,
  );
  expect(credits.entries).toEqual([
    expect.objectContaining({ kind: 'welcome_grant', amount: 30, balance_after: 30 }),
  ]);
  expect(credits.next_cursor).toBeNull();
  expect((await request.get('/api/v1/me/credits?cursor=nope', { headers })).status()).toBe(400);

  const upload = await request.post('/api/v1/uploads', {
    headers,
    data: { tool_id: 'compress-video', bytes: 20_000_000, mime: 'video/mp4' },
  });
  expect(upload.status()).toBe(201);
  const started = await expectShape(upload, Upload);
  expect(started.parts).toHaveLength(started.part_count);
  await expectShape(await request.get('/api/v1/jobs', { headers }), JobList);

  await expectShape(await request.post('/api/v1/auth/device', { data: {} }), DeviceCode);
  await expectShape(
    await request.get('/api/v1/me', { headers: { Authorization: 'Bearer x' } }),
    Problem,
  );
});

test('/developers lists every endpoint and passes axe', async ({ page }) => {
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: 'API for developers', level: 1 })).toBeVisible();
  const table = page.getByRole('region', { name: 'Endpoints' });
  for (const endpoint of ENDPOINTS) {
    await expect(table).toContainText(`${endpoint.method.toUpperCase()} ${endpoint.path}`);
  }
  await expect(page.getByRole('link', { name: 'OpenAPI document' })).toHaveAttribute(
    'href',
    '/api/v1/openapi.json',
  );
  const script = await page.request.get(
    (await page.getByRole('link', { name: 'run-tool.mjs' }).getAttribute('href')) ?? '',
  );
  expect(script.status()).toBe(200);
  expect(await script.text()).toContain('ETB_KEY');
  await signIn(page, newEmail());
  await page.goto('/developers');
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
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

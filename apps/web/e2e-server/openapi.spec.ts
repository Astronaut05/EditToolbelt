/**
 * The API's description against the API (docs/06 → Basics): the OpenAPI
 * document is served, `/developers` lists every endpoint, and real answers
 * parse with the same schemas the document is made from.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import {
  CreditList,
  DeviceCode,
  ENDPOINTS,
  JobList,
  Me,
  Problem,
  problemsOf,
  QuoteProbing,
  statusesOf,
  ToolDetail,
  ToolList,
  Upload,
  UploadCancelled,
  type Endpoint,
} from '@etb/core/api';
import { apiKeys, applyCredit, toolFlags, uploads, users } from '@etb/db';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
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
async function keyFor(email: string): Promise<{ key: string; userId: string }> {
  const [user] = await db.insert(users).values({ email, emailVerified: true }).returning();
  if (!user) throw new Error('no user');
  await applyCredit(db, user.id, 'welcome_grant', 30);
  return {
    key: await addKey(user.id, ['jobs:read', 'jobs:write', 'account:read']),
    userId: user.id,
  };
}

async function addKey(userId: string, scopes: string[]): Promise<string> {
  // 32 hex characters: letters and digits, as a key's body is.
  const key = `etb_live_${randomBytes(16).toString('hex')}`;
  await db.insert(apiKeys).values({
    userId,
    name: 'contract test',
    prefix: key.slice(0, 17),
    hash: createHash('sha256').update(key).digest('hex'),
    scopes,
  });
  return key;
}

/** The documented endpoint a request went to, by method and path. */
function endpointFor(method: string, url: string): Endpoint {
  const path = new URL(url).pathname.replace(/^\/api\/v1/, '');
  const found = ENDPOINTS.find(
    (endpoint) =>
      endpoint.method === method &&
      new RegExp(`^${endpoint.path.replace(/\{\w+\}/g, '[^/]+')}$`).test(path),
  );
  if (!found) throw new Error(`${method} ${path} is not in the document`);
  return found;
}

/**
 * An answer as the document says it can be: a status the route documents, a
 * problem's code listed under that status, and the `RateLimit-*` headers.
 */
async function expectDocumented(method: string, answer: APIResponse): Promise<void> {
  const endpoint = endpointFor(method, answer.url());
  const where = `${method.toUpperCase()} ${endpoint.path} → ${String(answer.status())}`;
  expect(statusesOf(endpoint), where).toContain(answer.status());
  if (answer.status() >= 400) {
    const { code } = (await answer.json()) as { code?: string };
    expect(problemsOf(endpoint)[answer.status()], where).toContain(code);
  }
  for (const header of ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
    expect(answer.headers()[header], `${where}: ${header}`).toMatch(/^\d+$/);
  }
}

test('the OpenAPI document is served and names this server', async ({ request }) => {
  const answer = await request.get('/api/v1/openapi.json');
  expect(answer.status()).toBe(200);
  expect(answer.headers()['access-control-allow-origin']).toBe('*');
  expect(answer.headers()['ratelimit-remaining']).toMatch(/^\d+$/);
  const doc = (await answer.json()) as {
    openapi: string;
    servers: { url: string }[];
    paths: Record<string, unknown>;
  };
  expect(doc.openapi).toMatch(/^3\.1\./);
  expect(doc.servers[0]?.url).toMatch(/\/api\/v1$/);
  expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/jobs', '/uploads']));
});

test('answers match the schemas, and their statuses the document', async ({ request }) => {
  // Every answer below is checked against the document at the end.
  const seen: [string, APIResponse][] = [];
  const call = async (
    method: 'get' | 'post' | 'delete',
    path: string,
    options: Parameters<APIRequestContext['fetch']>[1] = {},
  ) => {
    const answer = await request.fetch(path, { ...options, method: method.toUpperCase() });
    seen.push([method, answer]);
    return answer;
  };

  const tools = await expectShape(await call('get', '/api/v1/tools'), ToolList);
  expect(tools.tools.find((tool) => tool.id === 'compress-video')?.server).toBe(true);
  expect(tools.tools.find((tool) => tool.id === 'trim-video')?.server).toBe(false);
  expect((await call('get', '/api/v1/tools?surface=nope')).status()).toBe(400);

  const compress = await expectShape(await call('get', '/api/v1/tools/compress-video'), ToolDetail);
  expect(compress.options).toMatchObject({
    type: 'object',
    properties: { mode: { enum: ['size', 'quality'] }, codec: expect.any(Object) as unknown },
  });
  const burn = await expectShape(await call('get', '/api/v1/tools/burn-subtitles'), ToolDetail);
  expect(burn.extra_uploads).toEqual(['subtitles']);
  const browserOnly = await expectShape(await call('get', '/api/v1/tools/trim-video'), ToolDetail);
  expect(browserOnly.options).toBeNull();
  const missing = await call('get', '/api/v1/tools/no-such-tool');
  expect(missing.status()).toBe(404);
  await expectShape(missing, Problem);

  const { key, userId } = await keyFor(newEmail());
  const headers = { Authorization: `Bearer ${key}` };
  const me = await expectShape(await call('get', '/api/v1/me', { headers }), Me);
  expect(me.credit_balance).toBe(30);
  const credits = await expectShape(
    await call('get', '/api/v1/me/credits', { headers }),
    CreditList,
  );
  expect(credits.entries).toEqual([
    expect.objectContaining({ kind: 'welcome_grant', amount: 30, balance_after: 30 }),
  ]);
  expect(credits.next_cursor).toBeNull();
  expect((await call('get', '/api/v1/me/credits?cursor=nope', { headers })).status()).toBe(400);

  const upload = await call('post', '/api/v1/uploads', {
    headers,
    data: { tool_id: 'compress-video', bytes: 20_000_000, mime: 'video/mp4' },
  });
  expect(upload.status()).toBe(201);
  const started = await expectShape(upload, Upload);
  expect(started.parts).toHaveLength(started.part_count);
  await expectShape(await call('get', '/api/v1/jobs', { headers }), JobList);

  // Not finished yet, so no price; then given up.
  const early = await call('post', '/api/v1/jobs/quote', {
    headers,
    data: { tool_id: 'compress-video', upload_id: started.upload_id },
  });
  expect(early.status()).toBe(409);
  const cancelled = await call('delete', `/api/v1/uploads/${started.upload_id}`, { headers });
  expect(cancelled.status()).toBe(200);
  expect(await expectShape(cancelled, UploadCancelled)).toEqual({ status: 'cancelled' });

  // A finished upload the worker hasn't checked yet: 202 until it has.
  const [unprobed] = await db
    .insert(uploads)
    .values({
      userId,
      storageKey: `in/${randomUUID()}`,
      bytes: 18,
      mimeClaimed: 'video/mp4',
      toolId: 'compress-video',
      partSize: 8 * 1024 * 1024,
      partCount: 1,
      expiresAt: new Date(Date.now() + 3_600_000),
      completedAt: new Date(),
    })
    .returning({ id: uploads.id });
  const probing = await call('post', '/api/v1/jobs/quote', {
    headers,
    data: { tool_id: 'compress-video', upload_id: unprobed?.id },
  });
  expect(probing.status()).toBe(202);
  await expectShape(probing, QuoteProbing);

  // A key without the scope, and a wrong key.
  const jobsOnly = { Authorization: `Bearer ${await addKey(userId, ['jobs:read'])}` };
  expect((await call('get', '/api/v1/me', { headers: jobsOnly })).status()).toBe(403);
  await expectShape(
    await call('get', '/api/v1/me', { headers: { Authorization: 'Bearer x' } }),
    Problem,
  );

  await expectShape(await call('post', '/api/v1/auth/device', { data: {} }), DeviceCode);
  const unknownCode = await call('post', '/api/v1/auth/device/token', {
    data: { device_code: 'x'.repeat(43) },
  });
  expect(await unknownCode.json()).toMatchObject({ code: 'EXPIRED_TOKEN' });

  expect(seen.length).toBeGreaterThan(15);
  for (const [method, answer] of seen) await expectDocumented(method, answer);
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

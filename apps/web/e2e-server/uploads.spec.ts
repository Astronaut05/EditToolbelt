/**
 * Uploads straight to storage (docs/12 → M4: "Upload API (multipart
 * presign)"; docs/06, docs/11 → Storage). The browser PUTs the parts itself,
 * so these runs also prove storage's CORS and the page's connect-src allow it.
 * Compress Video's server path is switched on in the database for this file.
 */
import { AwsClient } from 'aws4fetch';

import { eq, toolFlags, uploads } from '@etb/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { SERVER_PORT, TEST_STORAGE } from '../scripts/server-env.ts';
import { closeTestDb, newEmail, signIn, testDb } from './helpers';

const db = testDb();
const ORIGIN = `http://localhost:${String(SERVER_PORT)}`;
const MIB = 1024 * 1024;

const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});

async function storedBytes(key: string): Promise<number | null> {
  const head = await storage.fetch(`${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}/${key}`, {
    method: 'HEAD',
  });
  return head.ok ? Number(head.headers.get('content-length')) : null;
}

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

function create(request: APIRequestContext, data: Record<string, unknown>, origin = ORIGIN) {
  return request.post('/api/v1/uploads', { data, headers: { Origin: origin } });
}

/** The first upload after switching the server path on waits for the 30 s flag cache. */
async function waitForServerPath(request: APIRequestContext) {
  await expect
    .poll(
      async () =>
        (
          await create(request, { tool_id: 'compress-video', bytes: 100, mime: 'text/plain' })
        ).status(),
      { timeout: 40_000, intervals: [1000] },
    )
    .toBe(415);
}

/** Creates an upload, PUTs every part from the page and completes it; all in the browser. */
function uploadFromPage(page: Page, bytes: number) {
  return page.evaluate(async (size) => {
    const post = (url: string, body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const created = await post('/api/v1/uploads', {
      tool_id: 'compress-video',
      bytes: size,
      mime: 'video/mp4',
    });
    const upload = (await created.json()) as {
      upload_id: string;
      part_size: number;
      part_count: number;
      parts: { n: number; url: string }[];
      complete_url: string;
    };
    const parts: { n: number; etag: string }[] = [];
    for (const part of upload.parts) {
      const length =
        part.n < upload.part_count
          ? upload.part_size
          : size - upload.part_size * (upload.part_count - 1);
      const put = await fetch(part.url, {
        method: 'PUT',
        body: new Uint8Array(length).fill(part.n),
      });
      parts.push({ n: part.n, etag: put.headers.get('etag') ?? '' });
    }
    const done = await post(upload.complete_url, { parts });
    return {
      created: created.status,
      upload,
      parts,
      done: done.status,
      result: (await done.json()) as unknown,
    };
  }, bytes);
}

test('uploads need an account, our own origin, and a tool that runs on the server', async ({
  page,
  request,
}) => {
  const anonymous = await create(request, {
    tool_id: 'compress-video',
    bytes: 10,
    mime: 'video/mp4',
  });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['content-type']).toBe('application/problem+json');
  expect(await anonymous.json()).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

  await signIn(page, newEmail());
  const foreign = await create(
    page.request,
    { tool_id: 'compress-video', bytes: 10, mime: 'video/mp4' },
    'https://evil.example',
  );
  expect(foreign.status()).toBe(403);

  const browserOnly = await create(page.request, {
    tool_id: 'trim-video',
    bytes: 10,
    mime: 'video/mp4',
  });
  expect(await browserOnly.json()).toMatchObject({ code: 'TOOL_UNAVAILABLE', status: 409 });

  const malformed = await create(page.request, { tool_id: 'compress-video', bytes: -1 });
  expect(await malformed.json()).toMatchObject({ code: 'BAD_REQUEST', status: 400 });
});

test('the registry’s limits and accepted types apply', async ({ page }) => {
  await signIn(page, newEmail());
  await waitForServerPath(page.request);
  const tooBig = await create(page.request, {
    tool_id: 'compress-video',
    bytes: 3 * 1024 ** 3,
    mime: 'video/mp4',
  });
  expect(tooBig.status()).toBe(413);
  expect(await tooBig.json()).toMatchObject({ code: 'FILE_TOO_LARGE', max_bytes: 2 * 1024 ** 3 });
  const wrongType = await create(page.request, {
    tool_id: 'compress-video',
    bytes: 10,
    mime: 'image/svg+xml',
  });
  expect(await wrongType.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT', status: 415 });
});

test('a browser uploads the parts straight to storage and completes the upload', async ({
  page,
}) => {
  await signIn(page, newEmail());
  await waitForServerPath(page.request);
  const bytes = 9 * MIB + 123; // two parts: 8 MiB and the rest
  const { created, upload, parts, done, result } = await uploadFromPage(page, bytes);
  expect(created).toBe(201);
  expect(upload).toMatchObject({ part_size: 8 * MIB, part_count: 2 });
  expect(upload.parts).toHaveLength(2);
  expect(done).toBe(200);
  expect(result).toEqual({ upload_id: upload.upload_id, bytes, status: 'uploaded' });

  const [row] = await db.select().from(uploads).where(eq(uploads.id, upload.upload_id));
  expect(row?.completedAt).not.toBeNull();
  expect(row?.multipartId).toBeNull();
  expect(row?.storageKey).toMatch(/^in\/[0-9a-f-]{36}$/);
  expect(await storedBytes(row?.storageKey ?? '')).toBe(bytes);

  // A retried complete answers the same.
  const again = await page.request.post(upload.complete_url, {
    data: { parts },
    headers: { Origin: ORIGIN },
  });
  expect(await again.json()).toEqual(result);
});

test('part URLs take only their own size, and come in batches', async ({ page }) => {
  await signIn(page, newEmail());
  await waitForServerPath(page.request);
  const created = await create(page.request, {
    tool_id: 'compress-video',
    bytes: 17 * MIB,
    mime: 'video/mp4',
  });
  const upload = (await created.json()) as {
    upload_id: string;
    parts: { n: number; url: string }[];
  };
  const [first] = upload.parts;
  // Storage refuses it (a 403 without CORS headers, so the browser sees a failed fetch).
  const accepted = await page.evaluate(
    async (url) =>
      fetch(url, { method: 'PUT', body: new Uint8Array(100) }).then(
        (response) => response.ok,
        () => false,
      ),
    first?.url ?? '',
  );
  expect(accepted).toBe(false);

  const more = await page.request.post(`/api/v1/uploads/${upload.upload_id}/parts`, {
    data: { from: 3, count: 5 },
    headers: { Origin: ORIGIN },
  });
  const batch = (await more.json()) as { parts: { n: number }[] };
  expect(batch.parts.map((part) => part.n)).toEqual([3]);

  // Completing with a part missing says which.
  const incomplete = await page.request.post(`/api/v1/uploads/${upload.upload_id}/complete`, {
    data: { parts: [{ n: 1, etag: 'abc' }] },
    headers: { Origin: ORIGIN },
  });
  expect(await incomplete.json()).toMatchObject({ code: 'UPLOAD_INCOMPLETE', missing: [2, 3] });

  // Cancelling ends it; its part URLs are no longer handed out.
  const cancel = await page.request.delete(`/api/v1/uploads/${upload.upload_id}`, {
    headers: { Origin: ORIGIN },
  });
  expect(cancel.status()).toBe(200);
  const [row] = await db.select().from(uploads).where(eq(uploads.id, upload.upload_id));
  expect(row?.deletedAt).not.toBeNull();
  const after = await page.request.post(`/api/v1/uploads/${upload.upload_id}/parts`, {
    data: { from: 1, count: 1 },
    headers: { Origin: ORIGIN },
  });
  expect(after.status()).toBe(410);
});

test('someone else’s upload looks like no upload at all', async ({ page, browser }) => {
  await signIn(page, newEmail());
  await waitForServerPath(page.request);
  const created = await create(page.request, {
    tool_id: 'compress-video',
    bytes: 10,
    mime: 'video/mp4',
  });
  const { upload_id: id } = (await created.json()) as { upload_id: string };
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await signIn(stranger, newEmail());
  const peek = await stranger.request.post(`/api/v1/uploads/${id}/parts`, {
    data: { from: 1, count: 1 },
    headers: { Origin: ORIGIN },
  });
  expect(peek.status()).toBe(404);
  await other.close();
});

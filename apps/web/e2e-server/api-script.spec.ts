/**
 * M6's done-when (docs/12): "a script with only an API key can run any
 * server tool end-to-end following the docs". The example script the docs
 * offer (public/examples/run-tool.mjs) runs as its own Node process with a
 * key and nothing else; the test plays the worker in the database, as in
 * jobs.spec.ts. The real worker runs it in the stack.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, apiKeys, eq, isNotNull, isNull, jobs, toolFlags, uploads, users } from '@etb/db';
import { expect, test } from '@playwright/test';
import { AwsClient } from 'aws4fetch';

import { SERVER_PORT, TEST_STORAGE } from '../scripts/server-env.ts';
import { closeTestDb, newEmail, testDb } from './helpers';

const db = testDb();
const SCRIPT = fileURLToPath(new URL('../public/examples/run-tool.mjs', import.meta.url));
const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});
const objectUrl = (key: string) => `${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}/${key}`;

test.describe.configure({ timeout: 120_000 });

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

async function newKeyHolder(): Promise<{ userId: string; key: string }> {
  const [user] = await db
    .insert(users)
    .values({ email: newEmail(), emailVerified: true })
    .returning({ id: users.id });
  if (!user) throw new Error('no user');
  // 32 hex characters: letters and digits, as a key's body is.
  const key = `etb_live_${randomBytes(16).toString('hex')}`;
  await db.insert(apiKeys).values({
    userId: user.id,
    name: 'script',
    prefix: key.slice(0, 17),
    hash: createHash('sha256').update(key).digest('hex'),
    scopes: ['jobs:read', 'jobs:write', 'account:read'],
  });
  return { userId: user.id, key };
}

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let i = 0; i < 300; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`gave up waiting for ${what}`);
}

test('the example script runs a server tool with only a key', async () => {
  const { userId, key } = await newKeyHolder();
  const dir = mkdtempSync(join(tmpdir(), 'etb-script-'));
  // Two parts: 9 MiB is more than one 8 MiB part.
  const input = join(dir, 'holiday.mp4');
  writeFileSync(input, randomBytes(9 * 1024 * 1024));
  const out = join(dir, 'small.mp4');

  const run = spawn(
    process.execPath,
    [SCRIPT, 'compress-video', input, '{"mode":"size","targetMb":5}', out],
    {
      env: {
        ...process.env,
        ETB_API: `http://localhost:${String(SERVER_PORT)}/api/v1`,
        ETB_KEY: key,
      },
    },
  );
  let stdout = '';
  let stderr = '';
  run.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  run.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => run.on('close', resolve));

  // The worker's part: probe the upload once it's complete…
  const upload = await until(async () => {
    const [row] = await db
      .select()
      .from(uploads)
      .where(
        and(eq(uploads.userId, userId), isNotNull(uploads.completedAt), isNull(uploads.probedAt)),
      );
    return row;
  }, `the upload (${stderr})`);
  expect(upload.bytes).toBe(9 * 1024 * 1024);
  expect(upload.partCount).toBe(2);
  await db
    .update(uploads)
    .set({
      probe: {
        container: 'mp4',
        duration_ms: 60_000,
        video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
      },
      probedAt: new Date(),
    })
    .where(eq(uploads.id, upload.id));

  // …then run the job it starts.
  const job = await until(async () => {
    const [row] = await db.select().from(jobs).where(eq(jobs.userId, userId));
    return row;
  }, `the job (${stderr})`);
  expect(job).toMatchObject({ source: 'api', funding: 'daily', options: { targetMb: 5 } });
  await db
    .update(jobs)
    .set({ status: 'running', progress: 50, stage: 'compressing', startedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const outputKey = `out/${randomUUID()}`;
  const output = 'a smaller video';
  await storage.fetch(objectUrl(outputKey), { method: 'PUT', body: output });
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      outputKey,
      outputMeta: {
        bytes: output.length,
        content_type: 'video/mp4',
        ext: 'mp4',
        notes: ['Landed at 4.9 MB.'],
      },
      finishedAt: new Date(),
      inputKey: null,
    })
    .where(eq(jobs.id, job.id));

  expect(await exited, stderr).toBe(0);
  expect(stdout.trim()).toBe(out);
  expect(readFileSync(out, 'utf8')).toBe(output);
  expect(stderr).toContain('uploading holiday.mp4: 100%');
  expect(stderr).toContain("price: one of today's free jobs (3 left)");
  expect(stderr).toContain('compressing: 50%');
  expect(stderr).toContain('Landed at 4.9 MB.');
  await storage.fetch(objectUrl(outputKey), { method: 'DELETE' });
});

test('the example script stops with the API’s own words', async () => {
  const run = spawn(process.execPath, [SCRIPT, 'trim-video', SCRIPT], {
    env: {
      ...process.env,
      ETB_API: `http://localhost:${String(SERVER_PORT)}/api/v1`,
      ETB_KEY: (await newKeyHolder()).key,
    },
  });
  let stderr = '';
  run.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => run.on('close', resolve));
  expect(code).toBe(1);
  expect(stderr).toMatch(/error: TOOL_UNAVAILABLE: /);
});

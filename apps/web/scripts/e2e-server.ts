/**
 * End-to-end tests of the server build (accounts, admin, uploads): migrates
 * TEST_DATABASE_URL, makes sure the test bucket exists, builds with
 * ETB_TARGET=server, then runs playwright.server.config.ts, which starts
 * `next start`. Needs Postgres and storage: `docker compose up -d postgres storage`.
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @etb/web e2e:server
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AwsClient } from 'aws4fetch';

import { OUTBOX, serverTestEnv, TEST_STORAGE } from './server-env.ts';

const env = { ...process.env, ...serverTestEnv() };
const web = fileURLToPath(new URL('..', import.meta.url));
const run = (command: string, args: string[], cwd = web) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });

rmSync(OUTBOX, { recursive: true, force: true });

// The test bucket; 409 means it's there already. Storage may still be starting.
const storage = new AwsClient({
  accessKeyId: TEST_STORAGE.S3_ACCESS_KEY_ID,
  secretAccessKey: TEST_STORAGE.S3_SECRET_ACCESS_KEY,
  service: 's3',
  region: TEST_STORAGE.S3_REGION,
});
let bucket: Response | null = null;
for (let attempt = 0; attempt < 30 && !bucket; attempt += 1) {
  bucket = await storage
    .fetch(`${TEST_STORAGE.S3_ENDPOINT}/${TEST_STORAGE.S3_BUCKET}`, { method: 'PUT' })
    .catch(() => null);
  if (!bucket) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!bucket || (!bucket.ok && bucket.status !== 409)) {
  process.stderr.write(
    `Storage at ${TEST_STORAGE.S3_ENDPOINT} is not answering (status ${String(bucket?.status ?? 'none')}).\n` +
      'Start it with `docker compose up -d storage`, or set TEST_S3_ENDPOINT.\n',
  );
  process.exit(1);
}

run(
  'node',
  ['scripts/migrate.ts'],
  fileURLToPath(new URL('../../../packages/db', import.meta.url)),
);
if (!process.argv.includes('--no-build')) run('pnpm', ['exec', 'next', 'build']);
run('pnpm', [
  'exec',
  'playwright',
  'test',
  '-c',
  'playwright.server.config.ts',
  ...process.argv.slice(2).filter((arg) => arg !== '--no-build'),
]);

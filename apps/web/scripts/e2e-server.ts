/**
 * End-to-end tests of the server build (accounts, and from M3's next parts
 * the admin): migrates TEST_DATABASE_URL, builds with ETB_TARGET=server,
 * then runs playwright.server.config.ts, which starts `next start`.
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm --filter @etb/web e2e:server
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { OUTBOX, serverTestEnv } from './server-env.ts';

const env = { ...process.env, ...serverTestEnv() };
const web = fileURLToPath(new URL('..', import.meta.url));
const run = (command: string, args: string[], cwd = web) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });

rmSync(OUTBOX, { recursive: true, force: true });
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

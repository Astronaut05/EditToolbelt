/**
 * Builds the site with the local-only workshop (design screens, component
 * gallery) and serves it on :4173. Workshop routes are files named
 * `*.workshop.tsx`; next.config.ts turns them on only when ETB_WORKSHOP=1, so
 * `pnpm preview` and CI builds never contain them. Works the same on Windows,
 * macOS and Linux (no inline env vars).
 *
 *   pnpm workshop            then open http://localhost:4173/workshop
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, ETB_WORKSHOP: '1' };
const shell = process.platform === 'win32';

const build = spawnSync('pnpm', ['run', 'build'], { cwd, env, stdio: 'inherit', shell });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('\nWorkshop: http://localhost:4173/workshop\n');
spawnSync('node', ['scripts/serve.ts', ...process.argv.slice(2).filter((arg) => arg !== '--')], {
  cwd,
  stdio: 'inherit',
  shell,
});

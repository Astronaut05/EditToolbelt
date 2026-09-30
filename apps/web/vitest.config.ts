import { configDefaults, defineConfig } from 'vitest/config';

// Playwright specs run with `pnpm e2e` (e2e/) and `pnpm e2e:server` (e2e-server/), not Vitest.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'e2e/**', 'e2e-server/**'] },
});

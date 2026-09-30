import { configDefaults, defineConfig } from 'vitest/config';

// Playwright specs in e2e/ run with `pnpm e2e`, not Vitest.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});

/**
 * drizzle-kit: `pnpm --filter @etb/db generate` writes a migration from the
 * schema; hand-written SQL (extensions, triggers) goes in `--custom` ones.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});

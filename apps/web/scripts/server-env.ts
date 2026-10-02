/**
 * The env the server build's end-to-end tests run with: a throwaway database
 * (TEST_DATABASE_URL), storage (TEST_S3_ENDPOINT, default the local stack's
 * on :7070, with its own `etb-test` bucket), a test-only auth secret, and
 * sign-in emails written to a folder the tests read. Shared by scripts/e2e-server.ts (build) and
 * playwright.server.config.ts (run), which must agree: SITE_URL is inlined
 * at build time.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_PORT = 4175;

export const OUTBOX = join(fileURLToPath(new URL('..', import.meta.url)), 'test-results', 'outbox');

/** The local stack's placeholder credentials; CI starts the same gateway with them. */
export const TEST_STORAGE = {
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:7070',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'etb-test',
  S3_ACCESS_KEY_ID: 'etb-local',
  S3_SECRET_ACCESS_KEY: 'etb-local-secret',
};

/** The test stub's webhook key (src/server/payments/stub.ts): a stand-in, never a real provider's. */
export const PAYMENTS_STUB_KEY = 'e2e-stub-key-not-a-real-provider-key';

export function serverTestEnv(): Record<string, string> {
  const database = process.env.TEST_DATABASE_URL;
  if (!database) {
    throw new Error(
      'TEST_DATABASE_URL: required for the server build tests (a throwaway Postgres 18 database).',
    );
  }
  return {
    ETB_TARGET: 'server',
    APP_ENV: 'test',
    APP_VERSION: process.env.APP_VERSION ?? 'e2e',
    NEXT_TELEMETRY_DISABLED: '1',
    SITE_URL: `http://localhost:${String(SERVER_PORT)}`,
    MODELS_BASE_URL: '/models',
    DATABASE_URL: database,
    BETTER_AUTH_SECRET: 'e2e-only-secret-never-used-anywhere-else-0123',
    MAIL_OUTBOX_DIR: OUTBOX,
    ...TEST_STORAGE,
    // Payments as production has them once turned on, with the test stub
    // standing in for Paddle (src/server/payments/stub.ts). Each provider's
    // admin switch still starts off, so nothing is sold until a test turns it on.
    PAYMENTS_ENABLED: 'true',
    PAYMENTS_STUB: 'paddle',
    PAYMENTS_STUB_KEY: PAYMENTS_STUB_KEY,
    // Accounts start at 0 credits, as the job tests expect; the grant has its own tests.
    WELCOME_GRANT_ENABLED: 'false',
  };
}

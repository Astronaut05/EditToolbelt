/**
 * The browser tests (e2e/) against a running production web service, through
 * Cloudflare Access: `E2E_BASE_URL=https://… pnpm --filter @etb/web e2e:prod`.
 *
 * - After a deploy (.github/workflows/smoke.yml): the live site, with CI's
 *   Access service token (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET).
 * - In CI (the "Production web image" job): the image Railway runs, started
 *   with a stand-in Access team (E2E_FAKE_ACCESS=1), so the token check runs
 *   for real on every request.
 *
 * Either way e2e-prod/global-setup.ts gets a CF_Authorization cookie and every
 * page, worker and asset request carries it. Tests that need the local
 * workshop skip themselves (e2e/fixtures.ts → remote). Chromium by default;
 * PW_BROWSERS picks others.
 */
import { defineConfig, devices } from '@playwright/test';

import { STATE } from './e2e-prod/global-setup.ts';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('E2E_BASE_URL: the site to test, e.g. http://localhost:8080');

const only = process.env.PW_BROWSERS?.split(',') ?? ['chromium'];
const chromium = process.env.PW_CHROMIUM
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } }
  : {};

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
  { name: 'phone', use: { ...devices['Pixel 7'], ...chromium } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
].filter((project) => only.includes(project.name));

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e-prod/global-setup.ts',
  fullyParallel: true,
  // Gentle on the one production instance.
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL, storageState: STATE, trace: 'retain-on-failure' },
  projects,
});

/**
 * End-to-end tests of the server build (ETB_TARGET=server): accounts now, the
 * admin next. `pnpm e2e:server` migrates the test database, builds, and runs
 * this; the server is `next start` with the test env (scripts/server-env.ts).
 * Desktop Chromium, Firefox and WebKit: cookies and redirects differ between
 * engines. PW_BROWSERS and PW_CHROMIUM work as in playwright.config.ts.
 */
import { defineConfig, devices } from '@playwright/test';

import { SERVER_PORT, serverTestEnv } from './scripts/server-env.ts';

const only = process.env.PW_BROWSERS?.split(',');
const chromium = process.env.PW_CHROMIUM
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } }
  : {};

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
].filter((project) => !only || only.includes(project.name));

export default defineConfig({
  testDir: 'e2e-server',
  // One worker: every test (all three browsers) shares one database, and the
  // admin tests switch tools off and on for the whole site.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${String(SERVER_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    command: `pnpm exec next start --port ${String(SERVER_PORT)}`,
    url: `http://localhost:${String(SERVER_PORT)}/healthz`,
    env: { ...serverTestEnv() },
    reuseExistingServer: !process.env.CI,
  },
});

/**
 * End-to-end tests against the production build served like Cloudflare Pages
 * (scripts/serve.ts, with _headers and the per-page CSP). Build with the
 * workshop first so the ToolShell demos exist:  pnpm e2e  (does both).
 *
 * Browsers: Chromium, Firefox and WebKit on desktop, plus a phone viewport
 * (docs/12 → M2 done-when). PW_BROWSERS=chromium limits the run; PW_CHROMIUM
 * points at a Chromium binary when Playwright's own isn't installed.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const only = process.env.PW_BROWSERS?.split(',');
const chromium = process.env.PW_CHROMIUM
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } }
  : {};

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
  { name: 'phone', use: { ...devices['Pixel 7'], ...chromium } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
].filter(
  (project) =>
    !only ||
    only.some(
      (browser) => project.name === browser || (browser === 'chromium' && project.name === 'phone'),
    ),
);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: `http://localhost:${String(PORT)}`, trace: 'retain-on-failure' },
  projects,
  webServer: {
    command: `node scripts/serve.ts --port ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/`,
    reuseExistingServer: !process.env.CI,
  },
});

/**
 * Lighthouse CI budgets (docs/10 → Budgets) on 5 representative pages of the
 * production build, served by `pnpm preview`'s server with its headers and
 * compression. Mobile emulation with simulated slow 4G and a 4× slower CPU:
 * stricter than the real-user p75 budgets in docs/10, so these are lab
 * ceilings. Reports stay on disk (apps/web/.lighthouseci); nothing is
 * uploaded. Run: pnpm lighthouse (after pnpm build).
 */
const PORT = 4175;
const PAGES = ['/', '/photo', '/remove-background', '/video-converter', '/privacy'];

module.exports = {
  ci: {
    collect: {
      startServerCommand: `node apps/web/scripts/serve.ts --port ${PORT}`,
      startServerReadyPattern: 'Serving',
      url: PAGES.map((path) => `http://localhost:${PORT}${path}`),
      numberOfRuns: 1,
      settings: { chromeFlags: '--no-sandbox --headless=new' },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['error', { maxNumericValue: 150 }],
        // Transfer size, Brotli-compressed as served.
        'resource-summary:script:size': ['error', { maxNumericValue: 160000 }],
      },
    },
    upload: { target: 'filesystem', outputDir: 'apps/web/.lighthouseci' },
  },
};

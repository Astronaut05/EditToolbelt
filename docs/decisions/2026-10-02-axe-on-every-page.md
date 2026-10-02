# 2026-10-02 · axe on every tool page, and Contrast Checker opens on a passing pair

**Decision:**
- **Every tool page and hub is checked by axe** (WCAG 2.2 AA, serious and critical findings), light and dark, as each opens: `apps/web/e2e/a11y-every-page.spec.ts`.
  - Chromium on a desktop only, on the local build only; about 200 page loads, 4 to 5 minutes of CI.
  - `a11y.spec.ts` still covers one page of each kind in every browser, plus the tools' working states.
  - The helper `seriousViolations` moved to `e2e/fixtures.ts` for both.
- **Contrast Checker opens on `#767676` on white** (4.54:1, the lightest grey that passes AA there), not `#777777` (4.47:1). Its own sample text failed AA as the page opened, which the sweep found. The near miss is still the e2e test's example and the FAQ's.

**Why:** rule 9 holds for every page, and a single tool's own defaults (here a colour pair) are what a page-type sample can't see. A one-off sweep of all 92 tools, 6 hubs and the pair pages found this one failure; the pair pages share their tool's view, so they're left to the tools' run.
**Reverse:** delete `a11y-every-page.spec.ts`; the default is `DEFAULTS` in `apps/web/src/tools/contrast-checker.tsx`.

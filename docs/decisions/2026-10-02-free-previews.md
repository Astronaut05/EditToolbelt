# 2026-10-02 · Free previews: a daily job when never paid, ten a day once paid

**Decision:**
- A tool lists its preview length in `@etb/registry/options` → `previewSeconds` (A10: 10 s) and takes `preview: true` in its options. The page cuts the snippet and sends it as its own upload; the API checks the probe says at most that long (+0.5 s for frame edges, else `413 FILE_TOO_LARGE`), and prices it at 0.
- **What pays** (`docs/05`: "Free previews … count against [the free allowance]"): a never-paid account spends one of its 3 daily jobs (`funding = 'daily'`); without one left the preview is refused (`QUOTA_EXCEEDED`). A paid account has no daily allowance, so its previews are free (`funding = 'none'`) and capped at 10 a day (`freeAllowance.paidDailyPreviews`), counted from job rows like the daily jobs.
- The preview runs the same processor on the snippet and always comes back as WAV, which the page plays A/B (Web Audio, both versions in step, switching keeps the place).
**Why:** `docs/05` and the 2026-09-30 decision ("Free previews (Wave 2) will count as daily jobs too") settle never-paid accounts; nothing settled paid ones, and an uncapped free preview would let anyone clean a long file 10 s at a time.
**Reverse:** `funding()` in `apps/web/src/server/jobs.ts` (the `preview` branch) and `freeAllowance.paidDailyPreviews` in `config/business.ts`.

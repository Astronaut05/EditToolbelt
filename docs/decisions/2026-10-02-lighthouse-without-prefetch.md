# 2026-10-02 · Lighthouse counts a page's own scripts, not the router's prefetches

**Decision:** `scripts/lighthouse.ts` blocks the requests of Next's router prefetch (`*_rsc=*`) in every Lighthouse run. The script-transfer budgets (160 KB, and 180 KB for working tool pages) now count only the scripts the page itself loads: its own chunks and the lazy parts it shows. Code for pages it links to is no longer counted.

**Why:** Once a page is idle, Next's router prefetches the pages its on-screen links lead to: their `?_rsc=` payloads, then their code. On every page this includes the home page's search (`HomeSearch`, 4,250 B), through the wordmark link. Whether that prefetch finished inside a Lighthouse run was down to timing. For main's build on one machine:

| Page | Prefetch not counted | Prefetch counted | Budget |
|---|---|---|---|
| `/remove-background` | 179,374 B | 183,624 B | 180,000 B |
| `/timecode-calculator` | 156,312 B | 160,562 B (the same 4,250 B chunk added) | 160,000 B |

So every pull request's Lighthouse step was a coin flip, whatever it changed. #106 failed it at 156 KiB on `/timecode-calculator`, while #103's run of nearly the same page read 152 KiB.

With the prefetch blocked, the same build reads the same bytes in every run. Best practices, accessibility and console errors are unchanged (100, 100, none). The budget decision already counts only what loads with the page ("Script budget for working tool pages" in `docs/DECISIONS.md`). Prefetching other pages stays on for visitors: it only fills the cache for a later click.

**Reverse:** set `BLOCKED` to `[]` in `scripts/lighthouse.ts`.

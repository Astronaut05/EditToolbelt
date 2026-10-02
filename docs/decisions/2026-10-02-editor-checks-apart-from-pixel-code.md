# 2026-10-02 · The shell's checks on the editor's changes sit apart from the pixel code

**Decision:** `isNeutral`, `NO_ADJUST` and `activeAreas` live in `packages/engines/src/image/edit-checks.ts`, which holds no pixel code. `adjust.ts` and `redact.ts` import and re-export them, and `@etb/engines` exports them from there.
**Why:** before a run, the ToolShell checks whether P01's adjustments moved and whether P12 has an area to hide. Importing those two functions from `adjust.ts` and `redact.ts` put both modules, about 2 KB of script, on every tool page, the same problem as the entry above. With #71's trim merged into group C, /remove-background read 181,175 bytes of script locally, over the 180 KB budget; with the checks apart, 179,100 (group B alone reads 177,783 on the same machine).
**Reverse:** define the three in `adjust.ts` and `redact.ts` again.

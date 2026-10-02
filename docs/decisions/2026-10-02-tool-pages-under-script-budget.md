# 2026-10-02 · Every tool page under its script budget: engines load with the first run

**Decision:** what a tool page loads before a file arrives is the shell, the tool's view and the engine's `capabilities` and `estimate`; the rest loads when it's needed. Six changes:
- **The crop box's helpers sit apart from the pixel code.** `clampRect`, `centredRatio`, `turnedSize` and `ratioValue` move from `packages/engines/src/image/geometry.ts` to `rect.ts`, which `geometry.ts` re-exports. The ToolShell's editor state (`useEditor` → `crop.ts`) imports them, so `geometry.ts` (turns, resampling, straightening: 3.6 KB) was on all 58 pages with the shell; only the image worker needs it.
- **`@etb/core` is `"sideEffects": false`.** Importing one thing from its index (`pdf`, `color`, `subtitles`, `checksum`) also loaded every module of it that runs code on load (timecode's frame rates and the social sizes, 1.9 KB). None of its modules needs to run for its effects; the bundler now drops the ones a page doesn't use.
- **The image engines, LUT Converter, the subtitle engines and Batch Rename load with their first run.** `packages/engines/src/lazy-engines/` has one small file per engine: its `capabilities` and `estimate` (`*_META`, which the engine spreads in, so both answer the same) and the engine `@etb/engines` exports, made with `lazyEngine`, as the media tools' engines already are. Async helpers a page calls as files arrive load the same way: `imageHeader` (Collage Maker, Images to PDF), `renamePlan` (Batch Rename), `readSubtitleFile` (Subtitle Editor), and Subtitle Sync reads its file through `loadSubtitleShift` and `import('@etb/core/subtitles')`. The views are unchanged but for Subtitle Sync's probe; the engines' code stays where it was, and so do their tests. `COLLAGE_SIZES`, `PALETTE_LIMITS` and the image format names (`format-labels.ts`) sit with the light side, as the pages read them before a file arrives.
- **Images to PDF loads fflate when it runs**, not with the page (10.2 KB; ToolShell already loads it lazily for ZIPs).
- **A hybrid tool's server path loads its API client, uploads and job tracking when the page first asks for the account or starts a job** (`apps/web/src/lib/server-jobs.ts`); `serverPath` keeps the price, limits and estimate (`server-run.ts`).
- **Batch Rename's date formats** are their own module in `@etb/core` (`rename-dates.ts`), so the page lists them without the rename rules.

**Why:** CI's Lighthouse checks the 180 KB tool-page script budget on two pages only. A sweep of every working tool page on main found 36 of 68 over it, up to 195,626 bytes (/images-to-pdf); hubs read 147,356. Now every working tool page reads at most 178,221 bytes (/batch-rename) and most 173-177 KB; /remove-background 175,940 (was 179,063) and /video-converter 175,581 (178,541). Measured locally on the static build, with the shared bytes checked against Lighthouse (`docs/decisions/2026-10-02-script-budget-on-every-page.md`). The 36 pages, before (the one-run Lighthouse sweep; the second column without the home page's prefetched code, 4,250 bytes, which that run sometimes counted) and after:

| Page | Sweep | Before | After |
|---|---|---|---|
| `/images-to-pdf` | 195,626 | 195,626 | 174,611 |
| `/subtitle-shift` | 192,121 | 187,871 | 174,154 |
| `/collage-maker` | 190,099 | 185,849 | 174,823 |
| `/batch-rename` | 187,648 | 187,648 | 178,221 |
| `/subtitle-editor` | 187,229 | 187,229 | 176,426 |
| `/subtitle-converter` | 186,971 | 186,971 | 173,073 |
| `/rotate-image` | 186,812 | 182,562 | 174,539 |
| `/color-palette-from-image` | 186,740 | 186,740 | 173,004 |
| `/draw-on-image` | 186,577 | 182,327 | 174,284 |
| `/lut-converter` | 186,514 | 182,264 | 172,725 |
| `/exif-remover` | 186,182 | 186,182 | 174,388 |
| `/color-picker-from-image` | 185,276 | 185,276 | 172,849 |
| `/remove-noise` | 185,097 | 185,097 | 176,192 |
| `/file-checksum` | 184,997 | 180,747 | 175,799 |
| `/image-to-svg` | 184,838 | 180,588 | 173,829 |
| `/social-media-image-resizer` | 184,736 | 184,736 | 176,657 |
| `/compress-video` | 183,642 | 183,642 | 176,753 |
| `/merge-videos` | 183,366 | 183,366 | 176,445 |
| `/replace-audio` | 183,085 | 178,835 | 175,920 |
| `/video-to-gif` | 183,084 | 178,834 | 175,936 |
| `/loop-video` | 182,924 | 178,674 | 175,769 |
| `/photo-editor` | 182,883 | 182,883 | 174,893 |
| `/resize-image` | 182,781 | 182,781 | 174,771 |
| `/extract-audio` | 182,769 | 178,519 | 175,550 |
| `/burn-subtitles` | 182,662 | 182,662 | 175,698 |
| `/vfr-to-cfr` | 182,660 | 182,660 | 175,719 |
| `/crop-image` | 182,606 | 182,606 | 174,585 |
| `/blur-image` | 182,588 | 182,588 | 174,587 |
| `/watermark-image` | 182,479 | 182,479 | 176,052 |
| `/add-text-to-image` | 182,320 | 182,320 | 174,284 |
| `/audio-to-video` | 182,101 | 177,851 | 174,903 |
| `/reverse-audio` | 181,753 | 177,503 | 174,523 |
| `/lut-preview` | 181,570 | 181,570 | 173,917 |
| `/split-image` | 180,622 | 180,622 | 174,751 |
| `/audio-channels` | 180,203 | 180,203 | 175,476 |
| `/bpm-key-finder` | 180,045 | 180,045 | 177,043 |

The budgets are unchanged. The initial JS of the HTML (`js-budget.ts`) is unchanged too: these pages' module scripts were already under it; what moved loaded after them.
**Reverse:** export the engines from their own modules in `packages/engines/src/index.ts` again (drop `lazy-engines/`, put each `*_META` back in its engine), import `zlibSync` statically in `images-to-pdf.ts`, merge `server-jobs.ts` back into `server-run.ts`, remove `"sideEffects": false` from `packages/core/package.json`, and define the crop helpers in `geometry.ts` and the date formats in `rename.ts` again.

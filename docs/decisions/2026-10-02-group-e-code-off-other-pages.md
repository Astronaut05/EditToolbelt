# 2026-10-02 · Group E's shell and core code stays off the other tool pages

**Decision:** three changes keep group E's tools out of the scripts every tool page loads, as the trim above does for the shell:
- **The Subtitle Editor parses its own cues.** The ToolShell hands the `cues` option's JSON to `SubtitleWorkspace` (`packages/ui/src/tool/SubtitleEditor.tsx`, loaded with React.lazy), which parses it with `cuesFromJson` and writes it back as JSON. The shell no longer imports `cuesFromJson`, which brought `packages/engines/src/subtitles.ts` and @etb/core's subtitle code to every tool page.
- **`writePdf` makes its `TextEncoder` when it runs**, not when `packages/core/src/image/pdf.ts` loads. A module that runs code on load stays in every page that imports `@etb/core`, used or not.
- **`apps/web/src/lib/urls.ts` imports `joinUrl` from the new `@etb/core/urls` entry point**, like `@etb/core/lut` and the others, so /remove-background (which needs `modelUrl`) no longer loads @etb/core's index and the modules that run code on load: timecode's frame rates, the social sizes and, before the change above, the PDF writer.

**Why:** with group D merged, group E read 191,599 bytes of script on /remove-background and 191,032 on /video-converter (Lighthouse, locally), over the 180 KB budget for tool pages. After the three changes, 178,609 and 178,106 (group D reads 179,613 and 177,339 on the same machine). Most of what's left of E's growth is the six new entries in `apps/web/src/tools/index.tsx` (about 130 bytes each on every tool page).
**Reverse:** pass parsed cues from the shell again (`cuesFromJson` in `ToolShell.tsx`), move the encoder back to the top of `pdf.ts`, and import `joinUrl` from `@etb/core`.

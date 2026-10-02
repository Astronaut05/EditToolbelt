# 2026-10-01 · Watermark Images (M8)

**Decision:**
- **Drawn in the image worker** after decoding (and after a LUT, if a later tool adds both), with `OffscreenCanvas`, then encoded like every photo tool's output. No new dependency.
- **Everything is a share of the photo's width:** the mark's width (1-100%, default 15%), the margin (0-25%, default 2%), the offset (−50% to 50% each way). Height follows the mark's own shape. The spot is one of nine on a 3 × 3 grid (`@etb/core/watermark`).
- **Text** is drawn once at 200 px in the browser's sans-serif, cut to its ink, then scaled to its box like a logo, so it's the same size relative to every photo whatever the font's metrics. Colour picked, default white; opacity 0-100%, default 60%.
- **Logo:** PNG, WebP or JPG up to 20 MB, checked by its bytes. SVG is left out: workers can't decode it (`createImageBitmap` has no SVG in a worker).
- **Tiled:** the mark repeats over the whole photo, half its width apart, every other row shifted by half a step, from half a mark outside the top-left corner, so no edge is bare.
- **The shell gains a `grid` option kind**, a 3 × 3 radio group (arrow keys move across and down), drawn by `PositionGrid` in `@etb/ui`.
- **The registry's `ui` is `form`, like the other photo tools,** not `batch`: one photo shows before and after and redoes it as a setting changes; several go to the batch list.

**Why:** `tools/photo.md` → P11.
**Reverse:** `packages/engines/src/image/watermark.ts`, `watermark-draw.ts`; the placement is `packages/core/src/image/watermark.ts`.

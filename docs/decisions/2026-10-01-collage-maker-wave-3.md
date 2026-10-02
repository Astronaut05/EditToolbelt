# 2026-10-01 · Collage Maker (Wave 3)

**Decision:**
- **Five layouts, each for 2 to 9 photos:**
  - Grid: rows as square as they get, the fuller rows last (5 photos are 2 then 3).
  - Big left and Big top: the first photo in the order set takes two thirds, the rest share the last third.
  - Columns and Rows.
- **Exact pixels.** A layout is a tree of rows and columns. The boxes are shared out in whole pixels that add up to the canvas, so every gap, between the photos and around the edge, is the spacing to the pixel.
- **Each photo fills its box**, cropped evenly from the sides or the top and bottom, never stretched. Phone photos are drawn upright by their EXIF.
- **Output sizes are twice the social sizes**, so a platform's own downscale stays sharp:
  - Square 2160 × 2160, Portrait 4:5 2160 × 2700, Story 9:16 2160 × 3840, Landscape 16:9 3840 × 2160.
  - A4 at 300 dpi, 2480 × 3508.
  - Spacing (0–120 px, default 24) and corner radius (0–120 px) are pixels at that size.
- **Encoding:** the photos are drawn on a canvas, which goes losslessly to the image worker and is saved by the same encoders as the other image tools. JPG (the default) and WebP at quality 90, or PNG. No metadata is written.

**Why:** `tools/photo.md` → P16.
**Reverse:** `packages/core/src/image/collage.ts` (layouts) and `packages/engines/src/image/collage.ts` (drawing, sizes).

# 2026-10-01 · Add Text to Image (M8)

**Decision:**
- **Fonts:** Onest and IBM Plex Mono (already the site's), plus Montserrat, Oswald and Noto Serif, from Fontsource (OFL-1.1, `docs/13`).
  - Each was checked in the browser to draw Uzbek Latin oʻ gʻ (U+02BB) and Uzbek Cyrillic қ ғ ҳ ў.
  - PT Serif, Caveat, Roboto Slab, Rubik, Lobster and Comfortaa each missed one, so they're out.
  - Regular and bold, in four subsets each. The files are copied to `/fonts/text/` at build (`scripts/text-fonts.ts`, 668 KB in all), registered with their unicode ranges, and loaded only as text needs them.
  - Fonts load under their own family names (`etb-text-*`), so they never clash with the site's Onest.
- **Your own font:** a TTF, OTF, WOFF or WOFF2 file picked in the panel is loaded with `FontFace` from its bytes and used on the page only; it's never sent anywhere.
- **Layers are data** in the editor's edit (text, font, bold, size in image px, colour, alignment, centre, rotation, outline, shadow, box), so undo and redo come with the editor.
- **One renderer, on the page:** the preview and the export both lay the text out with `drawTextLayer` and the page's fonts. The export draws the layers at full size on a transparent canvas the image's size, and the image worker lays that over the decoded image. Fonts aren't loaded into the worker, because not every browser can do that.
- **Layout:**
  - Lines at 1.25 × the size, centred on the layer's point.
  - Alignment within the block.
  - An outline drawn twice as wide under the fill, so it sits outside the letters.
  - A soft shadow scaled with the size, and a box with 0.3 × the size of padding at its own opacity.
- **Placing:**
  - Click the image to add text there, or Add text for the middle.
  - Drag the chosen layer; it snaps to the image's middle lines within 8 screen px, and a guide shows while it does.
  - Arrow keys nudge it (Shift for 10 px), and Delete removes it.
- **New text** is white, bold Onest with a shadow, a tenth of the image's shorter side.
- **On phones** the panel shows the text, font, size, bold and colour, with the rest folded under "More". It's capped at 55% of the editor, so the image stays in view.

**Why:** `tools/photo.md` → P10.
**Reverse:** the layers and renderer are `packages/engines/src/image/text-layer.ts`; the fonts are `text-fonts.ts`; the editor's parts are `packages/ui/src/tool/TextLayers.tsx` and `TextBar.tsx`.

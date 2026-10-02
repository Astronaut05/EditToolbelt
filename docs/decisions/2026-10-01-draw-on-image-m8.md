# 2026-10-01 · Draw on Image (M8)

**Decision:**
- **Marks are data, not pixels:** each is a tool, its points in the image's own pixels, a colour, a size in px and an opacity, kept in the editor's edit, so undo and redo come with the editor's history.
- **One renderer** (`drawMark` in `@etb/engines`): the editor draws the marks on a canvas over the image at screen scale, and the image worker draws them on the full-size decode before any crop or turn. What you see is what you save.
- **The tools:**
  - Brush: smoothed through the midpoints.
  - Highlighter: 4 × wider, square ends, multiplied, so text under it stays readable.
  - Line, arrow, rectangle, ellipse.
  - Numbered marker: the next number in a filled circle (its radius 5 × the size, at least 14 px), the number in black or white by contrast.
- **The arrowhead scales with the stroke:** 4 × the width long, about 2.5 × wide plus the width, never longer than the arrow. The shaft stops at the head's base, so a thick line never pokes out of the tip.
- **No drag needed** (WCAG 2.5.7): a shape is also two clicks, start then end, with a preview between them; a marker is one click; Escape drops a started shape. The pen's controls sit in a bar over the image: tools as a radio group with arrow keys, then colour, size in px, opacity, and Clear all.
- **Defaults:** a red arrow (#e53935), sized to the image (its longest side ÷ 250, at least 2 px), at full opacity.
- **One image at a time.** It saves in its own format unless another is picked, at its full size.

**Why:** `tools/photo.md` → P09.
**Reverse:** the marks and renderer are `packages/engines/src/image/annotate.ts`; the editor's layer is `packages/ui/src/tool/DrawLayer.tsx`.

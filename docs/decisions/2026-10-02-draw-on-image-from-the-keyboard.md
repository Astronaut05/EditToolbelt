# 2026-10-02 · Draw on Image from the keyboard

**Decision:**
- **"Add" in the draw bar** ("Add arrow", "Add rectangle", "Add marker" and so on, after the tool picked) puts a mark in the middle of the image and focuses it. A box or ellipse is a quarter of the image across, as Blur's "Add box". A line, arrow or stroke is a quarter of the longer side long and level on screen, in a turned or flipped photo too. A marker sits in the centre with the next number.
- **Every mark is a focusable box** over its extent (stroke, arrowhead or circle included), in the order drawn, named by its tool, number and place ("Rectangle 1, 100 × 75 px at 150, 113"):
  - Arrow keys move it 1 px, Shift 10 px, the way the screen shows.
  - Alt and the arrows change its size, as in Blur: a line or arrow moves its end (the arrow's tip), a box or ellipse its far corner (at least 2 px), a stroke stretches from its top left, and a marker grows with → and ↑.
  - Delete removes it; focus goes to the next mark, or the drawing area when none is left.
- The boxes only show in Draw mode and don't take the pointer, so drawing over a mark still draws. Each key press is one undo step.

**Why:** rule 9 and WCAG 2.1.1. Arrows, lines, boxes, ellipses and markers don't depend on the pointer's path, yet a keyboard user couldn't place, move or remove one (M8 review, finding 8). The 2.5.7 entry above only covered dragging.
**Reverse:** `centredPoints`, `moveMark`, `resizeMark` and `markBounds` in `packages/engines/src/image/annotate.ts`; the boxes and `onMarkKey` in `packages/ui/src/tool/DrawLayer.tsx`; `onAdd` in `CanvasEditor.tsx`.

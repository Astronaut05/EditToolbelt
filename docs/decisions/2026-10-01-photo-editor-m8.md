# 2026-10-01 · Photo Editor (M8)

**Decision:**
- **One editor, every mode:** Crop, Straighten, Rotate left and right, Flip both ways, Adjust, Draw, Text and Blur, in a rail on the left from the `lg` breakpoint and a scrolling bar along the bottom on phones. Undo and redo cover every mode. It opens on Adjust, so the photo shows clean.
- **No Resize mode in the rail:** the size is in the settings with the crop ratio, the format, the quality and the metadata: Original, Longest side in px, or Percentage. Those settings are the spec's export dialog. The saved file's size shows on the result, and "Back to the editor" keeps every edit.
- **Adjust:** exposure (−2 to +2 EV), brightness, contrast, saturation and warmth (−100 to 100).
  - Exposure and warmth are gains in linear light; warmth moves red and blue up to 15% (green a third of that).
  - Brightness is a midtone curve (v^2^(−b/100)) that keeps black and white.
  - Contrast is a slope of ¼× to 4× around middle grey.
  - Saturation mixes with Rec. 709 luma, from grey to twice as vivid.
  - Per-channel tables, then the saturation mix.
- **Live preview in JS, not WebGL:** the spec asks for WebGL. The same pure function instead runs on the editor's screen-sized copy, about 10 to 20 ms a frame, and in the worker at full size, so the preview is the file to the pixel.
- **Order:** adjustments, then hidden areas, marks and text in the photo's own pixels, then turns, flips, straighten, crop and size.
- **Crop with Straighten:** a box drawn on the straightened photo is cut in that frame. Only the part with no corners showing is kept. Crop Image and Rotate & Flip don't combine the two, so they're unchanged.
- **Turned and flipped photos:** layers live in the photo's own pixels and turn with it.
  - The editor maps the pointer through its zoom, angle, flips and turns, so drawing, boxes and dragging land where they're done.
  - Arrow keys move things the way they show on screen.
  - New text and numbered markers get an upright base, the inverse of the frame as a rotation and a mirror, so they read the right way in the saved image. A text shadow still falls downwards.
- **Find faces** is in Blur mode here too. The Photo Editor isn't listed under the AI filter, because face finding is a side feature.

**Why:** `tools/photo.md` → P01.
**Reverse:** the adjustments are `packages/engines/src/image/adjust.ts`, the upright helpers `upright.ts`, the rail `layout` prop on `CanvasEditor`, and the bar `AdjustBar.tsx`.

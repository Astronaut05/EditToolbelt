# 2026-10-01 · Gradient Generator (Wave 3)

**Decision:**
- **Laid out exactly as CSS does,** so the PNG matches the preview:
  - Linear: along a line through the centre, at the angle (0° up, 90° right), long enough that the corners meet the end stops.
  - Radial: a circle out to the farthest corner, which is CSS's `radial-gradient(circle, …)`.
  - Conic: clockwise from the angle, round the centre.
  - Before the first stop and after the last, their colours.
- **Plain blends in sRGB**, as browsers do by default.
- **Smooth blends in Oklch** along the shorter hue arc, with chroma lowered (hue and lightness kept) where a colour falls outside sRGB, the way CSS Color 4 maps gamut. A grey stop takes the other colour's hue, so the blend doesn't swing through others. Smooth is the default: it's the point of the tool.
- **Smooth CSS spells the blend out** as a stop every 10 %, rather than CSS's `in oklch`, so it looks the same in every browser, older ones included.
- **The PNG is dithered** (a 4 × 4 ordered pattern, half a step either way), so wide, gentle gradients don't band. It's drawn in the tab, up to 8,000 px a side.
- Up to 8 stops; "Add a stop" puts one halfway between the last two, in their blend. Everything is in the URL.

**Why:** `tools/color.md` → C07.
**Reverse:** `packages/core/src/color/gradient.ts`.

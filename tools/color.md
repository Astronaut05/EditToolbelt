# Color tools

Read with `docs/02-tool-framework.md`. All colour tools run in the browser. Colour maths lives in `packages/core/color.ts` (shared with the panel). Engine `image-color` = WebGL/canvas pixel sampling, quantisation, LUT application.

Shared rules:
- Work in sRGB for display; convert through linear light for any averaging or blending.
- Every colour readout shows HEX, RGB, HSL and a copy button per format.
- Colour-blind-safe UI: never rely on colour alone to show state.

---

### C01 · Color Palette from Image — `color-palette-from-image`
**Does:** Extract the dominant palette (3–12 colours) from an image.
**Controls:** number of colours, method (dominant / vibrant / muted), ignore near-white/near-black toggle.
**Behaviour:** k-means (or median cut) in Oklab on a downsampled copy; show swatches with % coverage; export as CSS variables, JSON, ASE (Adobe swatch exchange), PNG swatch strip, and a `.cube`-free "palette card" image.
**Tests:** fixture with 4 flat colour blocks → exactly those 4 colours ±ΔE 2.
**SEO:** "color palette from image" · "extract colors from image", "image color palette generator".

### C02 · Color Picker from Image — `color-picker-from-image`
**Does:** Click/tap anywhere on an image to read the exact colour; loupe magnifier; history of picked colours.
**Controls:** sample size (1 px, 3×3, 5×5 average), zoom.
**Tests:** pixel-exact read on a fixture.
**SEO:** "color picker from image" · "get hex code from image", "eyedropper online".

### C03 · Color Converter — `color-converter`
**Does:** Convert between HEX, RGB, HSL, HSV/HSB, CMYK (approximate, clearly labelled "not colour-managed"), Lab, Oklch, and nearest named CSS colour; plus tints/shades.
**Tests:** round-trip HEX→RGB→HSL→HEX exact for a fixture list.
**SEO:** "hex to rgb" · "rgb to hex", "color code converter".

### C04 · Contrast Checker — `contrast-checker`
**Does:** WCAG 2.2 contrast ratio for text/background with AA/AAA pass/fail for normal and large text; suggests the nearest passing colour.
**Tests:** known pairs produce the published ratios (e.g. black/white 21:1).
**SEO:** "color contrast checker" · "wcag contrast checker".

### C05 · LUT Preview on Image — `lut-preview`
**Does:** Load a `.cube` (1D/3D) LUT and preview it on a still (e.g. an exported frame) with intensity slider, before/after, and export of the graded image. Useful for picking LUTs before grading in an NLE.
**Behaviour:** WebGL 3D texture with trilinear (tetrahedral if feasible) interpolation; validate `.cube` syntax with clear errors; LUT file never leaves the browser.
**Tests:** identity LUT → output identical; known LUT on fixture matches reference render ±1/255.
**SEO:** "lut preview online" · "apply lut to image", "test cube lut".

### C06 · LUT Converter — `lut-converter` (Wave 3)
Convert `.cube` ↔ `.3dl`, resize LUT grid (17/33/65), 1D ↔ 3D where valid. **SEO:** "cube to 3dl".

### C07 · Gradient Generator — `gradient-generator` (Wave 3)
Linear/radial/conic gradients with stops; export CSS and PNG at chosen size; "smooth" option interpolating in Oklch to avoid muddy middles. **SEO:** "gradient generator".

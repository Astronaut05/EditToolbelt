# 2026-10-01 · Image to SVG (Wave 3)

**Decision:**
- **Our own tracer, not vtracer.** The spec named a WASM build of vtracer (MIT), but the register never settled on a package for it, and building one ourselves would add a Rust toolchain to CI. `packages/core/src/image/vectorize.ts` traces in a few hundred lines of TypeScript, in a worker, about a second for a 2 MP image. `docs/13` says vtracer isn't used.
- **How it traces:**
  - Colours: k-means in Oklab (the Colour Palette tool's clustering), the best of four seedings. Black and white splits at Otsu's threshold.
  - Before that, anti-aliased edges are made hard: a pixel between two very different colours on opposite sides of it takes the nearer one. Soft rims don't become rings of their own colour; thin lines keep theirs.
  - Detail: regions smaller than 64, 16 or 4 px (Low, Medium, High) join the neighbour nearest in colour.
  - Borders between regions are traced once, as chains between the points where three regions meet. Pixel steps become lines through their middles; turns gentler than 60° (Smooth) or 40° (Sharp) become curves; square corners between straight runs stay square. Pixels keeps every pixel edge.
  - Layers stack, the most common colour at the bottom, each also covering the layers above it. Neighbouring shapes never show a hairline gap, and every pixel still ends up its own colour. Black and white leaves the white out.
- **Size:** images are traced at up to 2000 px on the long side and drawn at their own size (the viewBox scales).
- **The file** holds only `<svg>` and `<path fill>` elements: no scripts, images, links or styles.
- **Changing a setting** traces again at once, so the before/after view compares straight away.

**Why:** `tools/photo.md` → P19; rule 6 asks for a license we can check.
**Reverse:** to use vtracer instead, swap `vectorize` in `packages/engines/src/image/vector/vector.worker.ts` and add it to the register.

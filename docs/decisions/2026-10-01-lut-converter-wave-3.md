# 2026-10-01 · LUT Converter (Wave 3)

**Decision:**
- **`.3dl` is Autodesk's**, as Flame, Lustre and Nuke read it. It starts with an input mesh line (the grid as 10-bit codes), then integer RGB with blue changing fastest. Reading:
  - The output depth is taken from the largest value: 10, 12 or 16 bit.
  - Lustre's `3DMESH`/`Mesh` header lines are skipped, and a file without a mesh line is read by its count.
  - A 3-point mesh looks like an RGB line, so it's told by the count of lines after it, or by its codes rising from 0.
- **Writing `.3dl`:** a 10-bit mesh and 12-bit values, the common choice. Values outside 0–1, which a `.cube` can hold, are clipped and counted in a note.
- **Resizing (17, 33 or 65)** reads the original with the tetrahedral lookup LUT Preview applies, so the new grid grades the same between the old points. A `.cube` with an input domain other than 0–1 is resampled to 0–1 for `.3dl`, which has no domain.
- **1D ↔ 3D only where exact:**
  - 1D to 3D: the curves at every grid point, 33 points unless a grid is picked.
  - 3D to 1D: only when each channel's output depends on its own input alone, within 0.001. A look that mixes channels is refused, with the reason.
- The default target is `.3dl` ("cube to 3dl" is what people search for), and a `.3dl` can be resized and saved as `.3dl`.

**Why:** `tools/color.md` → C06.
**Reverse:** `packages/core/src/color/lut-convert.ts` and `packages/engines/src/lut-convert.ts`.

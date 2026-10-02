# 2026-10-02 · LUT Converter: a .3dl's depth from its Mesh line

**Decision:** a `.3dl` with Lustre's `Mesh N B` header is read at the B-bit depth it states. Without that line, or when the values don't fit it, the depth is still taken from the largest value.
**Why:** M8 review, finding 12. A 12-bit darkening LUT whose largest value is 1023 was read as 10-bit, so white stayed white instead of going to a quarter.
**Reverse:** `parse3dl` in `packages/core/src/color/lut-convert.ts`.

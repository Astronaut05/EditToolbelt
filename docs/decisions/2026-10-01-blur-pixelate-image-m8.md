# 2026-10-01 · Blur & Pixelate Image (M8)

**Decision:**
- **Face model: YuNet 2023mar** from OpenCV's model zoo (MIT code and weights, `docs/13`). It's 0.2 MB, made for faces from about 10 px up, and runs on ONNX Runtime Web's WASM build, which Remove Background already ships, so the two tools share one 14 MB runtime download in the models cache.
  - Pinned by SHA-256. `pnpm models` fetches it from the zoo's LFS file on `main`; a change there fails the checksum instead of shipping.
  - **Reading a photo:** the model takes a fixed 640 × 640 input. The whole photo is read once, scaled to fit. When it's large, it's read again in overlapping tiles at 2× and 4× that detail, never finer than the photo's own pixels: 27 runs for a 4000 × 3000 photo, about 2 s in WASM. A face about 30 px across in a 4000 px group photo is found.
  - **Merging:** the best box wins over any it overlaps by IoU above 0.3, or that lies mostly inside it (a face cut by a tile's edge).
  - **Threshold:** 0.7, not OpenCV's 0.9. A missed face is worse than a box the user turns off.
- **Found faces are hidden at once:** each becomes an ellipse grown from the detector's brow-to-chin box to cover the head (15% each side, 30% above, 10% below). A tap or Enter on a face's button leaves it as it is, and a second turns it back on. A new search replaces the earlier faces and keeps drawn areas.
- **Areas are data** in the editor's edit (box, ellipse or brush path in image px), with one effect for all of them: Blur, Pixelate or Solid. So undo and redo come with the editor.
- **Effects replace every pixel inside an area,** with no feathered edge, so nothing of a face shows through:
  - **Pixelate:** blocks of the set size, counted from the area's top-left corner, each the opacity-weighted average of its pixels.
  - **Blur:** three box blurs each way (about a Gaussian with σ = half the strength), reading the pixels around the area too.
  - **Solid:** a colour, black by default.
- **Strength in px:** it starts at about 1/60 of the photo's longest side (67 px on a 4000 px photo), up to 1/8.
- **One renderer:** the same pure code in `packages/engines` makes the editor's preview (the photo redrawn at screen size) and, in the image worker, the full-size image, before marks, text and geometry.
- **Without a pointer:** "Add box" puts a box in the middle. Each drawn box or ellipse can be focused: the arrows move it (Shift for 10 px), Alt and the arrows change its size, and Delete removes it.
- **Fixture:** `fixtures/photo/face.jpg`, NASA's public-domain portrait of Eileen Collins at 256 px. The test puts four copies at four sizes into one image. Wikimedia is out of reach from the build container, so the copy in scikit-image's repository was used, checked against its SHA-256.

**Why:** `tools/photo.md` → P12.
**Reverse:** the areas and effects are `packages/engines/src/image/redact.ts`; the finder is `packages/engines/src/image/faces/`; the editor's parts are `packages/ui/src/tool/BlurLayer.tsx`. To raise or lower the threshold or the tile levels, change `FACE_THRESHOLD` or `MAX_LEVEL` in `faces/yunet.ts`.

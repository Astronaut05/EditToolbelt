# 2026-10-01 · Images to PDF (Wave 3)

**Decision:**
- **Our own PDF writer, not pdf-lib.** The spec named pdf-lib (MIT), which hasn't had a release since 2021, and images on pages is all this needs. `packages/core/src/image/pdf.ts` writes a plain PDF 1.4 in under 300 lines, and `docs/13` says pdf-lib isn't used.
- **JPEGs go in byte for byte** (DCTDecode), so nothing is re-compressed. That covers 8-bit baseline or progressive JPEGs, grey or colour. A phone photo saved on its side with an EXIF orientation is placed upright by the matrix that draws it, still without re-encoding.
- **Everything else is decoded by the browser** (upright, as shown) and stored losslessly as deflated RGB, with fflate, already in the register. Transparency becomes a soft mask. That covers PNG, WebP, GIF, AVIF, CMYK and 12-bit JPEGs, and HEIC where the browser opens it.
- **Pages:** A4 (the default) or US Letter, or each page the image's own size at 96 px to the inch. Orientation follows each image unless portrait or landscape is set. Margins are none, 10 mm (the default) or 20 mm. Each image is scaled to fit inside the margins, centred, keeping its shape.
- **Order:** the shell's file list, reorderable, 1 to 100 images. The PDF is named after the first image in that order.
- **Shell:** a single result now takes the engine's own download name when it gives one (`EngineOutput.name`, so far only used by batches). A combined list's line under each file can leave out a duration, since images have none.

**Why:** `tools/photo.md` → P18.
**Reverse:** `packages/core/src/image/pdf.ts` and `packages/engines/src/image/images-to-pdf.ts`; to use pdf-lib instead, swap `writePdf` and add it to the register.

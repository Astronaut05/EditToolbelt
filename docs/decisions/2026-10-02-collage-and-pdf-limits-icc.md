# 2026-10-02 · Collage Maker and Images to PDF: limits from the header, ICC profiles kept

**Decision:**
- **The 100 MP limit is checked before anything decodes:** each image's first half megabyte (more for a JPEG whose metadata runs longer) gives its format and size, with `checkImage`'s 200 MB and 100 MP limits. The list's line under each file comes from the same header, so adding an image no longer decodes it, and one over the limit is marked there and stops the run until it's removed. The engines check every header again before drawing any.
- AVIF, HEIC and TIFF don't say their size in the header we read: the list shows their format only, and the size is checked once decoded.
- The decoding stays on the main thread, as before. Moving it to the image worker would bring nothing more for these limits.
- **ICC profiles:** a JPEG's embedded profile (APP2 "ICC_PROFILE", in pieces) becomes its image's `ICCBased` colour space, with DeviceRGB or DeviceGray as the alternate, so Display P3 phone photos keep their colours. A profile with a piece missing, or not for the JPEG's colours (RGB or grey), is left out as before. A version 4 profile, as Display P3 is, makes the file PDF 1.5, the version that reads them. Other images are decoded to sRGB by the browser, so they stay DeviceRGB.

**Why:** M8 review, finding 7, and the rule gap under finding 15 (the photo rules keep embedded profiles). A 20000 × 20000 PNG of a few KB took about 1.6 GB per copy and crashed the tab instead of showing the limit.
**Reverse:** `packages/engines/src/image/image-header.ts`; `jpegInfo`'s `icc` and `writePdf` in `packages/core/src/image/pdf.ts`.

# Photo tools

Read with `docs/02-tool-framework.md`. Shared rules for every photo tool:

- **Input formats (browser):** JPG, PNG, WebP, AVIF, GIF (first frame unless stated), BMP, TIFF (8/16-bit, first page), HEIC/HEIF (via libheif, lazy-loaded). Validate by magic bytes.
- **Output formats:** same as input by default; user can pick JPG, PNG, WebP, AVIF where the tool allows. PNG/WebP/AVIF keep transparency; JPG fills transparency with white (option to pick colour).
- **Colour:** keep embedded ICC profile when re-encoding to formats that support it; convert to sRGB for WebP/AVIF output unless "keep profile" is on. Respect EXIF orientation on load (apply, then reset the tag).
- **Metadata:** default **strip GPS**, keep camera/copyright EXIF. Toggle "Remove all metadata". Say this in the UI.
- **Limits (browser):** 100 MP decoded, 200 MB file. Above → clear error (or server offer where a server path exists).
- **Batch:** tools marked batch accept up to 50 files; outputs downloadable individually or as ZIP (fflate, in browser).
- **Quality baseline for tests:** output dimensions exact; SSIM ≥ 0.98 vs. reference for lossless-geometry ops; file opens in Chrome, Safari, Firefox.

---

### P01 · Photo Editor — `photo-editor`
**Does:** All-in-one quick editor using `CanvasEditor` with every mode enabled: crop, resize, rotate/flip, draw, text, blur/pixelate, basic adjustments (brightness, contrast, saturation, exposure, warmth).
**In → Out:** one image → one image.
**Controls:** mode rail on the left (bottom bar on mobile); per-mode options panel; undo/redo; export dialog (format, quality, size preview).
**Behaviour:** non-destructive stack until export; adjustments applied in WebGL for live preview; export renders at full resolution in a worker.
**Tests:** apply crop + rotate + text + brightness, export PNG, compare to reference render.
**SEO:** "online photo editor free no sign up" · "quick photo editor".

### P02 · Crop Image — `crop-image`
**Does:** Crop freely, to an aspect ratio, or to exact pixel size.
**In → Out:** image(s) → image(s). Batch: same crop ratio applied centred (with per-image adjust).
**Controls:** ratio presets (Free, 1:1, 4:5, 16:9, 9:16, 4:3, 3:2, 2:3, 21:9, custom), exact W×H in px, position X/Y, "centre", rule-of-thirds grid, rotate 90° shortcut.
**Behaviour:** opens `CanvasEditor` in crop mode; crop handles keep ratio when locked; shows output px live.
**Tests:** 4000×3000 → 1:1 centred → 3000×3000; exact 1080×1350 crop from arbitrary box; transparency preserved for PNG.
**SEO:** "crop image" · "crop photo online", "crop image to 16:9", "crop picture to square".

### P03 · Resize Image — `resize-image`
**Does:** Resize to exact pixels, percentage, or fit/fill a box; batch.
**In → Out:** image(s) → image(s).
**Controls:** mode (Exact W×H / Width only / Height only / Percentage / Longest side), lock ratio (default on), fit mode when ratio unlocked (Stretch / Fit with padding colour / Fill and crop), resampling (Lanczos default), presets (HD 1280×720, Full HD 1920×1080, 4K 3840×2160, Instagram 1080×1080, Story 1080×1920, YouTube thumbnail 1280×720), output format/quality, target file size (optional → hands to compress logic).
**Behaviour:** upscaling beyond 100 % warns and suggests P08 Upscale for quality.
**Tests:** exact dims for each mode; batch of 10 mixed sizes → longest side 2048; padding colour correct.
**SEO:** "resize image" · "resize image to 1920x1080", "resize photo in pixels", "batch resize images".

### P04 · Rotate & Flip Image — `rotate-image`
**Does:** Rotate 90/180/270, free angle (with auto-crop or expand canvas), flip horizontal/vertical; batch for 90° ops.
**Controls:** quick buttons; angle slider −45…45 with 0.1° steps; "straighten" grid; background for expanded canvas (transparent/colour).
**Behaviour:** 90° JPG rotations are re-encoded at quality 95 by default (note shown).
**Tests:** 90° swaps dims; free 10° with expand gives expected bounding box; flip is pixel-exact.
**SEO:** "rotate image" · "flip image", "mirror image online", "straighten photo".

### P05 · Compress Image — `compress-image`
**Does:** Reduce file size by quality or to a target size; batch.
**Controls:** mode (Quality slider / Target size in KB or MB), format (keep / JPG / WebP / AVIF / PNG lossless optimise), max dimensions (optional), strip metadata toggle.
**Behaviour:** target-size mode binary-searches quality (max 8 iterations) and, if still too big at quality 40, suggests reducing dimensions. Shows before → after size and % saved; before/after slider.
**Tests:** 5 MB JPG → target 500 KB lands within ±5 %; PNG optimise never grows the file (keep original if it would).
**SEO:** "compress image" · "compress jpeg to 100kb", "reduce image size", "compress png".

### P06 · Image Converter — `image-converter`
**Does:** Convert between image formats, including HEIC → JPG/PNG. Batch. Also powers the image conversion pair pages.
**Controls:** output format (JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, ICO for Wave 3 pair page), quality, background for transparency→JPG, keep/strip metadata.
**Behaviour:** HEIC decode via libheif WASM (lazy); if the browser can decode HEIC natively (Safari), prefer native. Animated GIF/WebP → static formats use the first frame with a note; animated → animated WebP keeps frames.
**Tests:** every in/out pair in the whitelist round-trips with correct dims; HEIC from iPhone fixture → JPG with correct orientation.
**SEO:** "image converter" · pair pages: "heic to jpg", "webp to jpg", "png to jpg", etc.

### P07 · Remove Background — `remove-background`
**Does:** Cut out the subject and output a transparent PNG/WebP, or put it on a colour/blur/replacement image.
**Runtime:** hybrid. Browser model via onnxruntime-web (RMBG weights are banned — see `docs/13-licenses.md`):
- **Quality mode (default): BiRefNet_lite fp16 (115 MB, MIT)** on WebGPU. Needs WebGPU with `shader-f16`; checked by capability detection.
- **Light mode: a small model (u2netp or an ISNet int8 build — pick by the M2 benchmark)** on WASM, for devices without WebGPU fp16, or when the user declines the big download. The UI labels it "Light mode" and explains the quality trade-off in one line. The fp32 BiRefNet (224 MB) is never sent to the browser.
- If an int8 BiRefNet_lite build keeps IoU within 0.01 of fp16 in the M2 benchmark, ship it instead (smaller download, same quality).
- Server path (M5): BiRefNet general or HR on GPU for high-res (> 12 MP), weak devices, and the API; flat credits.
**Controls:** output (Transparent / Colour / Blur original / Replace with image), edge refine (soft/hard), shadow toggle (Wave 3), output format (PNG/WebP), "Refine" brush (keep/erase) in `CanvasEditor`.
**Behaviour:** first use shows model download progress (one time). Process at model resolution, upscale mask to original with guided filter for edges; apply to full-res image. Server path only after user accepts the quote.
**Limits:** browser 24 MP; server 50 MP.
**Tests:** 5 fixture images (person with hair, product on white, pet, car, low contrast) — IoU ≥ 0.9 vs. reference masks; output has alpha; server fallback offered for 30 MP input.
**SEO:** "remove background from image" · "background remover free", "transparent background maker", "remove bg no sign up".

### P08 · Upscale Image — `upscale-image`
**Does:** AI upscale 2× / 4× (Real-ESRGAN family): a general model and an illustration/anime model. Face restoration is out until a commercially licensed face model passes `13`.
**Runtime:** gpu. Credits per output megapixels.
**Controls:** scale (2×, 4×), model (General / Illustration & anime), denoise strength, output format.
**Behaviour:** preview a 512×512 crop result for free before paying (runs as a tiny server job counted against free allowance, or skipped if allowance is used — then show quote directly). Output capped at 64 MP.
**Tests:** 1000×750 → 4× → 4000×3000; tiled inference for large inputs produces no seams (edge-diff check).
**SEO:** "upscale image" · "ai image upscaler", "increase image resolution", "enhance photo quality".

### P09 · Draw on Image — `draw-on-image`
**Does:** Annotate: brush, highlighter, line, arrow, rectangle, ellipse, numbered markers.
**Controls:** tool, colour, size, opacity; undo/redo; export.
**Tests:** stroke rendering matches reference; arrow head scales with stroke width.
**SEO:** "draw on image" · "annotate screenshot", "add arrow to image".

### P10 · Add Text to Image — `add-text-to-image`
**Does:** Text layers with font, size, colour, stroke, shadow, background box, alignment, rotation.
**Controls:** font list (bundled OFL fonts incl. Cyrillic + Uzbek Latin support; user can load a local font file — stays local), layer list, snapping guides.
**Tests:** multi-line centred text renders at the same position as the preview at export resolution.
**SEO:** "add text to image" · "put text on photo", "caption image online".

### P11 · Watermark Images — `watermark-image`
**Does:** Batch-apply a text or logo watermark.
**Controls:** type (Text / Logo image), position (9-grid + offset), size as % of image width, opacity, tile mode, margin.
**Behaviour:** position is relative, so it stays consistent across different image sizes.
**Tests:** 20 mixed-size images → logo at bottom-right, 15 % width, identical relative placement.
**SEO:** "watermark images" · "add logo to photos", "batch watermark".

### P12 · Blur & Pixelate — `blur-image`
**Does:** Blur or pixelate regions (brush or rectangle), or auto-detect faces and blur them (privacy).
**Runtime:** client; face detection via small ONNX model (license check in `13`).
**Controls:** mode (Blur / Pixelate / Solid box), strength, "Detect faces" button (then toggle each face), license-plate manual box.
**Tests:** fixture with 4 faces → 4 detections; pixelate block size exact.
**SEO:** "blur face in photo" · "pixelate image", "censor image online".

### P13 · Social Media Image Resizer — `social-media-image-resizer`
**Does:** One image → one or many platform sizes at once.
**Controls:** checklist of presets grouped by platform (Instagram post 1080×1080 & 1080×1350, story/reel cover 1080×1920; YouTube thumbnail 1280×720, banner 2560×1440; TikTok 1080×1920; X post 1600×900, header 1500×500; LinkedIn post 1200×627, banner 1584×396; Facebook cover; Pinterest 1000×1500), fit mode (Fill & crop with focal point / Fit with blurred background / Fit with colour), focal point picker.
**Behaviour:** preset table lives in `packages/core/social-presets.ts` with a `verified_on` date per preset; review quarterly.
**Tests:** 6 presets from one image → exact dims, focal point respected.
**SEO:** "instagram image resizer" · "resize image for youtube thumbnail", "social media image sizes".

### P14 · Split Image into Grid — `split-image`
**Does:** Split into rows×cols tiles (carousel/panorama posts, 3×3 profile grids).
**Controls:** rows, cols, presets (1×2, 1×3, 1×10 carousel, 3×3), gap handling, output naming order.
**Tests:** 3×3 of 3000×3000 → 9 × 1000×1000 in row-major order.
**SEO:** "split image into grid" · "instagram grid maker", "panorama carousel splitter".

### P15 · Photo Metadata Viewer & Remover — `exif-remover`
**Does:** Show all metadata (camera, lens, settings, date, GPS on a small static map-less coordinate readout) and remove all or selected groups; batch.
**Behaviour:** removal re-writes the container without re-encoding pixels where the format allows (JPEG segment strip); otherwise lossless re-encode.
**Tests:** GPS fixture → after removal no GPS tags; pixel data unchanged for JPEG (byte-compare the scan data).
**SEO:** "remove exif data" · "view photo metadata", "remove location from photo".

### P16 · Collage Maker — `collage-maker` (Wave 3)
**Does:** 2–9 images into layout templates. **Controls:** template, spacing, corner radius, background, output size preset. **Tests:** 4-image grid exact geometry. **SEO:** "photo collage maker".

### P17 · Object Eraser — `object-eraser` (Wave 3)
**Does:** Brush over an object, AI fills the area (inpainting, LaMa-class model). **Runtime:** gpu, flat credits. **Controls:** brush size, undo, "erase". Preview at reduced size free, full-res costs. **Tests:** fixture with mask → output dims unchanged, masked area changed, rest identical. **SEO:** "remove object from photo".

### P18 · Images to PDF — `images-to-pdf` (Wave 3)
**Does:** Multiple images → one PDF, ordering, page size (A4/Letter/fit image), margins, orientation. Uses pdf-lib (MIT, add to register). **SEO:** "jpg to pdf".

### P19 · Image to SVG — `image-to-svg` (Wave 3)
**Does:** Vectorise logos/illustrations (vtracer WASM, MIT). **Controls:** colour count, detail, smoothness, mode (B/W, colour). **Behaviour:** output SVG is generated by us (no scripts). **SEO:** "png to svg", "vectorize image".

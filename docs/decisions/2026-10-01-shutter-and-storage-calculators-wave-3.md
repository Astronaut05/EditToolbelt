# 2026-10-01 · Shutter Angle and Recording Storage calculators (Wave 3)

**Decision:**
- **Wave 3 starts:** M8's browser work is done, and its other tools wait on M5 or a model runtime (`STATUS.md` → Blocked), so Wave 3's browser tools come next, one small group per PR. These two calculators go together, as Contrast and DPI did.
- **Shutter angle:**
  - Speed = angle ÷ (360 × fps). 23.976, 29.97 and 59.94 mean the exact NTSC rates (24000/1001 and so on).
  - A speed can be typed as 1/50, 50 (what a camera shows) or 0.02.
  - **Flicker:** lights on mains power pulse at twice its frequency. Speeds lasting a whole number of pulses (within 1%), up to 360°, are listed as flicker-safe. When the frame rate divides the pulse rate evenly (25 fps on 50 Hz, 30 on 60), every frame starts at the same point of the pulse, so the page says no speed flickers, though a rolling shutter may still show still bands.
  - A speed longer than a frame is flagged, not clamped.
- **Storage:**
  - Decimal units throughout, as cards and drives are labelled (1 TB = 10¹² bytes). The page says Windows shows 931 GB for 1 TB.
  - Hours are rounded down to the minute.
  - Space needed comes with and without a backup copy, plus the number of 128 GB cards.
- **"Editable table" of codecs:** a list of typical bitrates, labelled "check your camera's manual". A row's Use button fills the bitrate, and the bitrate field takes the camera's own value, which marks the codec "My own bitrate". Values: Apple's ProRes figures at 29.97 fps, Sony XAVC S 4K at 100 Mbps, and typical phone and mirrorless rates.

**Why:** `tools/subtitles-and-time.md` → T07, T08; `docs/12` → "Then — Wave 3".
**Reverse:** the maths is in `packages/core/src/calc/shutter.ts` and `storage.ts`.

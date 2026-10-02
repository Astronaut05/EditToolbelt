# 2026-10-01 · Split Audio (Wave 3)

**Decision:**
- **The parts are the timeline's ranges.** The settings fill them in, and any part can be moved, dropped or added before the split, as Remove Silence does with its cuts. Four ways to fill them: equal parts, pieces of a length (a sliver under 0.05 s at the end joins the piece before), at silences, or by hand.
- **At silences, the split is in the middle of each pause** that is at least as long as set (1 s at first), so nothing is lost and each part keeps half a pause either side. A silence at the very start or end stays with the first or last part. The silence finder is Remove Silence's, auto threshold included.
- **Up to 50 parts**, the timeline's limit for ranges. Past that, the page asks for longer pieces.
- **Each part is a Trim Audio "keep":** MP3, AAC and Opus in their own format are copied frame by frame (cut at the nearest frame), and WAV and FLAC are cut to the sample. Only a change of format encodes again.
- **The download is one ZIP, stored without compression** (audio is already compressed), with the parts named `name_01.mp3` and on. A single part downloads as the file itself.

**Why:** `tools/audio.md` → A14.
**Reverse:** `packages/core/src/media/split.ts` (the parts) and `packages/engines/src/audio/split.ts`.

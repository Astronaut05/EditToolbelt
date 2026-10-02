# 2026-10-01 · Change Video Speed (M8)

**Decision:**
- **Two ways with the picture:**
  - Keep every frame (the default): every packet is copied with its time divided by the speed. It's instant and lossless, and the frame rate scales with the speed (30 fps at 2× plays at 60 fps).
  - Keep frame rate: the video is redrawn at its own rate, dropping frames to speed up or repeating them to slow down, and re-encoded. This is for editors who need the original rate.
  - Redrawn frames are encoded at the video's size rounded to even numbers (`even()`, shared with Merge Videos): H.264 and HEVC take only even sizes, so a 1437 × 899 screen recording comes out at 1438 × 900, and the notes say so.
  - The settings show the length and the frame rate each way would give.
- **Speeds:** 0.25×, 0.5×, 0.75×, 1.25×, 1.5×, 2×, 3× and 4×, or a custom speed from 0.25× to 4× in 0.05 steps.
- **Sound:**
  - Keep pitch (the default) time-stretches it with the core `TimeStretch` from Change Speed & Pitch.
  - Shift pitch plays it faster or slower as it is, like tape, with the Resampler.
  - Mute leaves it out.
  - It's re-encoded in the container's usual codec.
- **A clip lasts to the end of its last frame**, as in Merge Videos (`shownFor`, now shared in `video/held.ts` with the frame reader).
- **The spec's pitch test** ("spectral centroid within tolerance") is done as zero crossings per second of the decoded sound, against the source's: the same within 5% when kept, double within 0.1 when shifted at 2×.

**Why:** `tools/video.md` → V13.
**Reverse:** `packages/engines/src/video/video-speed.ts`.

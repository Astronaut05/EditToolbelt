# 2026-10-01 · Audio to Video (Wave 3)

**Decision:**
- **What it draws:** spectrum bars (40, log-spaced from 50 Hz to 16 kHz, levels from −70 to −10 dBFS, rising at once and falling back by 0.82 a frame) or a waveform line (40 ms of sound around each frame, scaled so the loudest moment reaches 90% of the height). Mono mix, Hann-windowed 2048-point FFT, our own code in `packages/core/src/media/audiogram.ts`.
- **Frame:** 9:16 (1080 × 1920, the default), 1:1 (1080 × 1080) or 16:9 (1920 × 1080), 30 fps. The title on top, the sound in the middle, captions below, in the bundled Onest bold. A picture fills the frame (cropped, not stretched) under a 45% darkening, so the bars and words stay readable. Without a picture, text is white, or near-black on a light background.
- **Captions** come from a subtitle file (SRT, VTT, ASS or SBV) timed to the whole recording, such as Transcribe Audio's (A12, a GPU tool for later). Only the words are drawn; styling tags are dropped. Up to 3 lines, on a dark box.
- **Length:** the timeline picks the part, the first minute to start with, up to 10 minutes (18 000 frames) a video.
- **Encoding:** H.264 and AAC in MP4 where the browser writes both (Chrome, Edge, Safari), otherwise VP9 (or VP8) and Opus in WebM, with a note. WebM can also be picked. The sound is resampled to 48 kHz, stereo or mono as it was.
- **The audio is read twice**, once for the picture and once for the sound, so a long file never sits in memory.

**Why:** `tools/audio.md` → A16.
**Reverse:** `packages/core/src/media/audiogram.ts` and `packages/engines/src/video/audiogram.ts`.

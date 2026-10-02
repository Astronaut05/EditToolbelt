# 2026-10-01 · Merge Videos (M8)

**Decision:**
- **Fast join when the clips match:**
  - When every clip has the same video codec, decoder settings (the codec string and its parameter sets, byte for byte), size and rotation, and the same audio (or none), their packets are copied end to end into the first clip's container.
  - Nothing is decoded; it takes seconds.
  - This holds only with a cut and the first clip's size and frame rate. Choosing anything else re-encodes.
  - Each clip's sound starts exactly with its picture, so nothing drifts however many clips are joined (`placeCopiedSound`):
    - An encoder's priming before a later clip's start is left out: AAC's first 1024 samples, which the container's edit list hides. Copied, they would play as 21 ms of extra sound at each join.
    - A packet that would run past its clip's picture by more than 1 ms (Matroska's resolution) is left out, which leaves a gap shorter than one packet (21 ms of AAC) at that join. PCM is cut at the picture's end instead, which loses nothing.
    - Start times only go forward; a packet is never moved later because the one before it ran long. Moving them was what made the sound about 32 ms later at each join.
- **Re-encode otherwise:**
  - Every frame is drawn on one constant clock, at the first clip's size and its frame rate rounded to the nearest standard one, or a size (2160 to 480 p) and rate (24 to 60 fps) picked. This is the spec's "CFR without drift": a 25 fps clip in a 30 fps result plays at its own speed.
  - Clips of another shape are fitted on black.
  - The codec follows the first clip's container: H.264, HEVC or AV1 in MP4, VP9 in WebM and MKV, the first the browser can encode.
  - Each clip's decoder opens at its first frame and closes after its last, so at most two are open at once (in a crossfade).
- **A clip lasts to the end of its last frame:** Matroska often leaves the last frame's duration out, which would end the clip a frame early and land the next clip on top of that frame.
- **The sound follows its picture:** each clip's sound is brought to 48 kHz stereo and cut or padded to its own picture's length, so no clip drifts. In a crossfade it fades equal-power, and the picture dissolves linearly.
- **Crossfade:** 0.5, 1 or 2 s at every join, at most half the shortest clip.
- **The list** is the shell's combine mode from Merge Audio: 2 to 20 clips, reordered by keyboard.
- **Up to 2 GB in all,** the browser limit for video: the joined file is built in memory. Clips that come to more are refused before any is read, as Loop Video refuses too many repeats.
- **The server path for large totals** (the spec's hybrid runtime and per-minute price): built on 2026-10-02, jobs that take several uploads (see [2026-10-02-merge-videos-on-our-servers.md](2026-10-02-merge-videos-on-our-servers.md)). Its switch stays off until an admin turns it on; until then the page offers only the browser path.

**Why:** `tools/video.md` → V12.
**Reverse:** `packages/engines/src/video/merge-videos.ts`; the fixture `clip-vp9-25fps.webm` is described in `fixtures/video/README.md`.

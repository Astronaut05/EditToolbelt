# 2026-10-01 · Loop Video (Wave 3)

**Decision:**
- **Copied when it can be, the "fast concat":** each repeat is the clip's own packets, its timestamps moved along by the clip's length. That is instant and lossless, and the sound is copied the same way. The encoder's lead-in is kept only in the first copy, so timestamps stay in order.
- **A length that ends partway through a copy** cuts that copy's last frames. Copying stays safe when no frame depends on a later one. A clip with reordered frames (B-frames, common in H.264 from cameras) is encoded again instead, and the note says why.
- **Boomerang:** one loop is every frame forwards, then backwards without repeating the two frames it turns on (0…N−1, N−2…1), so it loops without a stutter. It is encoded again at high quality, with the picture read backwards a stretch at a time (`ClipFrames`) and the sound reversed with it.
- **Limits:** 2 to 50 repeats, or a length up to 60 min, which is the browser limit for video. A copy that would pass 2 GB is refused, since the result is built in memory.

**Why:** `tools/video.md` → V19.
**Reverse:** `packages/engines/src/video/loop-video.ts`.

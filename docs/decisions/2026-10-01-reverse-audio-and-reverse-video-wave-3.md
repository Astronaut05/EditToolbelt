# 2026-10-01 · Reverse Audio and Reverse Video (Wave 3)

**Decision:**
- **Read backwards a window at a time.** Media decodes only forwards, so both tools read the file from its end in short stretches, decode each, turn it round and encode it. Memory stays at one stretch, however long the file (`@etb/core`'s `reversePieces`).
  - **Sound:** 10 s windows. Each is decoded from 0.2 s before it, which is thrown away, so a lossy decoder has settled. Frames are placed by timestamp, so the windows meet with nothing lost or doubled.
  - **Picture:** stretches of up to 90 frames, fewer for big frames (a 384 MB budget of RGBA copies). Each frame is copied out of the decoder at once, so the decoder never runs out of frames, and keeps its own duration, so a variable frame rate stays as it was.
- **Reverse Audio's selection:** the timeline starts with the whole file selected. A smaller selection reverses only that part, the rest stays as it was, and the audio dips to silence for 5 ms either side of each join so the jump doesn't click. WAV and FLAC stay lossless; lossy formats are encoded again at the file's own bitrate.
- **Reverse Video:** always encoded again (a reversed picture can't be copied), in the clip's own container, at high quality. The sound is reversed over the picture's length, or left out. Clips over 5 min get a "this will take a while" note before starting (`tools/video.md` → V18: long clips warn).

**Why:** `tools/audio.md` → A15, `tools/video.md` → V18.
**Reverse:** `packages/engines/src/audio/reverse.ts`, `video/reverse-video.ts` and `video/clip-frames.ts` (the stretch size is `framesPerStretch`).

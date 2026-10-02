# 2026-10-01 · Change Speed & Pitch: our own phase vocoder, not Signalsmith Stretch (M8)

**Decision:**
- **Time-stretching is our own code** (`TimeStretch` in `@etb/core`), not Signalsmith Stretch (MIT, which `tools/audio.md` names and `docs/13` lists as preferred).
  - Signalsmith's web build is an AudioWorklet that loads its own code from a `blob:` URL. Our CSP doesn't allow `blob:` scripts, and allowing it for one tool would weaken the CSP for every page.
  - Its API is built for live playback in an AudioContext. An offline file would have to go through an OfflineAudioContext holding the whole output in memory.
  - SoundTouch (LGPL) stays out too: no LGPL in the browser.
- **How it works:**
  - A phase vocoder with identity phase locking (Laroche & Dolson): 4096-point Hann frames at a quarter-frame synthesis hop (85 ms at 48 kHz).
  - Each peak's phase advances at its measured frequency; the bins around it keep their phase relative to it, which keeps tones clean.
  - It is streamed (a few frames in memory), pure and unit-tested. A minute of stereo takes about 2.6 s.
  - The result is exactly round(input × ratio) long.
- **Pitch** = stretch by 2^(semitones/12), then the core `Resampler` back to the original rate: the same length, the pitch moved.
- **Vinyl** = the Resampler alone: faster and higher together.
- **Controls:**
  - Tempo 25-400%.
  - Pitch −12 to +12 semitones plus −50 to +50 cents.
  - Format: Keep, MP3, WAV or FLAC.
  - The run waits until something would change. The settings show the new length.
- **Channels** are stretched independently, up to stereo. Formant preservation is a Wave 3 idea, as the spec says.
- **Reverse:** if Signalsmith ships a build that runs in a worker without `blob:` code, `TimeStretch` is the one place to swap. Video speed (V13) will use the same class.

**Why:** `tools/audio.md` → A08, rule 6 and the CSP (`docs/11`).
**Reverse:** `packages/core/src/audio/stretch.ts`, `fft.ts`; the engine is `packages/engines/src/audio/pitch.ts`.

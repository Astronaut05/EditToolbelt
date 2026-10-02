# Audio tools

Read with `docs/02-tool-framework.md`. Shared rules for every audio tool:

- **Input (browser):** MP3, WAV (PCM 16/24/32f), FLAC, OGG/Opus, M4A/AAC, AIFF, WebM audio; audio tracks from video files. Decode in a worker.
- **Output:** MP3 (WebCodecs has no MP3 encoder — use the lazy-loaded encoder listed in `13`), WAV (16/24-bit PCM), FLAC, OGG/Opus, M4A/AAC (WebCodecs AudioEncoder where the browser supports AAC, otherwise the lazy-loaded AAC encoder in `13`; decide with `AudioEncoder.isConfigSupported`, never by browser name). Default output = input format, except analyzers.
- **Sample rate / bit depth:** keep by default. Resampling uses a high-quality windowed-sinc resampler.
- **Metadata:** keep ID3/Vorbis tags on conversion; cover art kept where the target format supports it.
- **Edits are sample-accurate**; cuts get a 5 ms fade to avoid clicks unless the user turns it off.
- **Timeline:** shared `Timeline` with waveform, zoom, snap to zero-crossings, play/loop selection, keyboard.
- **Limits (browser):** 2 hours / 1 GB decoded PCM budget; phones: 30 min recommended.
- **Tests:** duration within ±1 ms (lossless) / ±1 frame of the codec (lossy); loudness assertions ±0.5 LU; no clipping introduced (true peak check).

---

### A01 · Audio Converter — `audio-converter`
**Does:** Convert between formats; change sample rate (e.g. 44.1 → 48 kHz for video), bit depth, channels; batch. Powers audio pair pages.
**Controls:** format, bitrate/quality (MP3 CBR 128/192/256/320, VBR V0–V4), sample rate (keep/44.1/48/96 kHz), bit depth (16/24), channels (keep/mono/stereo).
**Tests:** WAV 44.1 → 48 kHz: duration identical, tone fixture frequency preserved; MP3 320 kbps header correct.
**SEO:** "audio converter" · "wav to mp3", "convert 44.1 to 48khz", "m4a to mp3".

### A02 · Trim Audio — `trim-audio`
**Does:** Cut start/end or multiple ranges; fades at edges.
**Controls:** Timeline, keep/remove ranges, fade in/out durations, output format (keep = lossless copy for WAV/FLAC).
**Tests:** trim 5.000–15.000 → 10.000 s ±1 ms (WAV).
**SEO:** "trim audio" · "cut mp3", "audio cutter".

### A03 · BPM & Key Finder — `bpm-key-finder`
**Does:** Detect tempo (BPM) and musical key (with Camelot notation for DJs), plus a **tap tempo** pad and a **metronome** (set BPM, time signature, accent, sound) — so editors can cut to the beat.
**Runtime:** client, in-house DSP (no AGPL libraries): onset-strength envelope → autocorrelation/tempogram for BPM (report top candidate + half/double alternatives); chroma features → key profile correlation (Krumhansl-type) for key; confidence shown for both.
**Controls:** analyse whole track or a selection; BPM range hint (60–90 / 90–140 / 140–200); metronome controls; "Export beat markers" (CSV/TXT of beat times; Premiere marker import format in Wave 3).
**Behaviour:** analysis on a downmixed, resampled (22.05 kHz) copy for speed; results in < 2 s for a 4-min song on desktop.
**Tests:** labelled fixture set (≥ 30 tracks across genres, license-free): BPM within ±1 of label (or exact half/double) for ≥ 90 %; key correct or relative/fifth-related for ≥ 75 %; record the baseline in the test.
**SEO:** "bpm finder" · "find key of song", "song key and bpm finder", "tap tempo", "online metronome".

### A04 · Merge Audio — `merge-audio`
**Does:** Join files in order with optional crossfades; or layer (mix) tracks with levels.
**Controls:** order, gap/crossfade per join, mode (Join / Mix), output format, normalise output toggle.
**Tests:** 3 × 10 s with 1 s crossfades → 28 s; no clipping in mix (auto-gain).
**SEO:** "merge audio files" · "combine mp3 files", "join audio".

### A05 · Normalize Loudness — `normalize-audio`
**Does:** Set integrated loudness to a target (LUFS) with a true-peak ceiling.
**Controls:** presets — Streaming/YouTube −14 LUFS, Podcast −16 LUFS (stereo), Broadcast EBU R128 −23 LUFS, Film/TV US −24 LKFS, Custom; true-peak ceiling (−1 dBTP default); mode (Gain only / Gain + limiter).
**Behaviour:** measure with ITU-R BS.1770 / EBU R128 gating (in-house implementation, validated against pyloudnorm in tests); gain-only if it fits under the ceiling, otherwise a transparent true-peak limiter (oversampled).
**Tests:** reference files hit target ±0.5 LU; true peak ≤ ceiling; measurement matches reference implementation ±0.1 LU.
**SEO:** "normalize audio" · "lufs normalizer", "normalize to -14 lufs", "make audio louder".

### A06 · Loudness Meter — `loudness-meter`
**Does:** Analyse only: integrated LUFS, short-term max, momentary max, loudness range (LRA), true peak, RMS, and pass/fail against platform targets; loudness-over-time graph.
**Tests:** same reference set as A05.
**SEO:** "lufs meter online" · "check audio loudness", "true peak meter".

### A07 · Fade In / Fade Out — `fade-audio`
**Does:** Fades with curve choice (linear, exponential, logarithmic, S-curve).
**Controls:** durations, curves, preview.
**Tests:** gain at fade midpoint matches the curve formula.
**SEO:** "fade in fade out audio" · "add fade to mp3".

### A08 · Change Speed & Pitch — `change-pitch`
**Does:** Change tempo without pitch, pitch without tempo (semitones/cents), or both together (vinyl-style).
**Runtime:** client; time-stretch via Signalsmith Stretch (MIT, WASM — see `13`); SoundTouch (LGPL) only as a fallback.
**Controls:** tempo %, pitch semitones (−12…+12) + cents, mode, formant-preserve (Wave 3 idea).
**Tests:** +2 semitones on a 440 Hz tone → 493.9 Hz ±1 Hz, duration unchanged; tempo 125 % → duration × 0.8.
**SEO:** "change pitch of song" · "speed up audio", "transpose audio", "key changer".

### A09 · Stem Splitter — `stem-splitter`
**Does:** Separate vocals, drums, bass, other (4 stems) or vocals/instrumental (2 stems, "karaoke").
**Runtime:** gpu (Demucs-class model, MIT). Per-minute credits.
**Controls:** 2 or 4 stems, output WAV/MP3, quality (Standard / High = more shifts, costs more).
**Behaviour:** free 20-second preview of the stems (from a chosen segment) before paying, counted against free allowance; one-line reminder that users need rights for their use of the separated audio.
**Tests:** fixture mix of known stems → SDR above a recorded baseline per stem.
**SEO:** "vocal remover" · "stem splitter", "separate vocals from music", "remove vocals from song".

### A10 · Noise Reduction — `remove-noise`
**Does:** Clean speech: reduce background noise, hum, hiss (DeepFilterNet-class model); optional de-hum (50/60 Hz notch series) and gentle de-ess.
**Runtime:** cpu (model runs acceptably on CPU; move to GPU if queue data says so). Per-minute credits. Video input → audio extracted in browser, cleaned, remuxed back in browser.
**Controls:** strength (Light / Medium / Strong), de-hum (off/50/60 Hz), output format; A/B preview on a 10 s snippet free.
**Tests:** noisy speech fixture → SNR improves by ≥ a recorded baseline; duration unchanged; no clipping.
**SEO:** "remove background noise from audio" · "noise reduction online", "clean up voice recording".
**Built (2026-10-02, beta):** not a model yet. DeepFilterNet's code is MIT / Apache-2.0, but nothing licenses its weights (`13` → Pending review), so A10 runs on ffmpeg's own filters: the background is measured in the quiet gaps (level and tilt), then a 60 Hz high-pass, notches at 50 or 60 Hz and 7 harmonics, afftdn (FFT noise filter; Light / Medium / Strong = up to 12 / 24 / 40 dB less, its floor set from the measured noise), ffmpeg's de-esser when asked. Same sample count, true peak ≤ −1 dBTP by gain only. The page and copy say "FFT noise filter", never "AI". Swapping in the model later changes the worker's denoise step only (`docs/DECISIONS.md` → A10).
**Length:** the worker cleans from two raw 32-bit copies of the sound, so a job takes up to 8 GiB of them: 4 h of mono or about 3 h 6 min of stereo at 48 kHz, less at higher rates or with more channels (up to 8). The jobs API refuses longer files before charging, with the most it takes at that rate and channel count.

### A11 · Remove Silence — `remove-silence`
**Does:** Detect and cut (or shorten) silences — voiceovers, podcasts, lectures.
**Controls:** threshold (dBFS or auto from noise floor), minimum silence length, keep padding, mode (Remove / Shorten to X ms), preview of detected regions on the Timeline (toggle each).
**Output:** processed audio, plus an **EDL/marker list** of the cuts (CSV; Premiere-compatible XML in Wave 3) so editors can apply the same cuts to video.
**Tests:** fixture with known pauses → detected regions within ±20 ms.
**SEO:** "remove silence from audio" · "cut silence podcast", "auto cut silences".

### A12 · Transcribe Audio — `transcribe-audio`
**Does:** Speech → text with timestamps (TXT, SRT, VTT, DOCX-free plain formats, JSON with words). Same engine as V17.
**Runtime:** gpu, per-minute credits. Languages including Uzbek, Russian, English; speaker labels in Wave 3.
**Tests:** shared with V17.
**SEO:** "transcribe audio to text" · "audio to text uzbek", "mp3 to text".

### A13 · Audio Channel Tools — `audio-channels`
**Does:** Stereo → mono (sum or pick L/R), mono → stereo, swap L/R, split stereo into two mono files, fix "one-sided" lav audio (copy L to both), invert phase of one channel, detect dual-mono.
**Tests:** L-only fixture → "copy L to both" yields identical channels.
**SEO:** "stereo to mono" · "fix audio only in one ear", "split stereo channels".

### A14 · Split Audio — `split-audio` (Wave 3)
Split into equal parts, by duration, at silences, or at markers. ZIP output. **SEO:** "split mp3".

### A15 · Reverse Audio — `reverse-audio` (Wave 3)
Reverse whole file or selection. **SEO:** "reverse audio".

### A16 · Audio to Video — `audio-to-video` (Wave 3)
Audiogram: waveform/spectrum animation over a background image/colour with optional title and captions (from A12), 9:16 / 1:1 / 16:9. Browser render with WebCodecs. **SEO:** "audiogram maker", "mp3 to mp4 with image".

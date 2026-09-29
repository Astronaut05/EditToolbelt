# Video tools

Read with `docs/02-tool-framework.md`. Shared rules for every video tool:

- **Input (browser):** MP4, MOV, WebM, MKV; AVI/others via ffmpeg.wasm fallback or server. Codecs: whatever the browser's WebCodecs decodes (probe with `VideoDecoder.isConfigSupported`); otherwise ffmpeg.wasm (software, slower) or server offer.
- **Output default:** MP4 (H.264 + AAC) via WebCodecs hardware encoder; WebM (VP9/AV1 + Opus) as option. If the browser can't encode H.264, fall back to WebM with a note, or offer server.
- **Fast vs precise:** when an operation can be done by stream copy (trim on keyframes, mute, remux, rotate flag), do that by default — instant, no quality loss — and label it "Fast (no re-encode)". "Precise" re-encodes. Show which mode is used and why.
- **Audio:** keep original audio stream when possible (copy); re-encode to AAC 192 kbps / Opus 160 kbps otherwise. Not every browser's WebCodecs can encode AAC — feature-detect and use the AAC encoder from `13`; never silently put Opus audio in an MP4.
- **Rotation metadata** (phone videos) is respected on decode and written correctly on output.
- **HDR / 10-bit:** detect; if the path can't preserve it, warn ("Output will be SDR") before processing.
- **VFR:** detect variable frame rate (from `media-probe`) and mention it where it matters (trim precision, merge, Premiere sync) with a link to V15.
- **Limits:** browser — 2 GB file, 60 min (desktop), 500 MB / 10 min shown as recommended on phones; above → server offer where the tool has a server path. Server — by tier (registry).
- **Timeline:** trim-type tools use the shared `Timeline` with thumbnail strip, frame-step keys, I/O marks.
- **Tests:** output duration within ±1 frame (precise) or ±1 GOP (fast, stated); A/V sync drift < 40 ms over 60 s; plays in Chrome/Safari/Firefox.

---

### V01 · Trim Video — `trim-video`
**Does:** Cut the start/end, or keep/remove multiple ranges and join them.
**Controls:** Timeline with in/out handles, add range, "keep selected" vs "remove selected", mode Fast/Precise, output format.
**Behaviour:** Fast = snap to nearest keyframes, stream copy (Mediabunny). Precise = full re-encode at launch; re-encoding only the GOPs at the cut points ("smart cut") comes in M2b.
**Tests:** 60 s clip trim 10.000–20.000 precise → 10.00 s ±1 frame; multi-range join has no audio clicks (crossfade 10 ms at joins).
**SEO:** "trim video" · "cut video online", "cut mp4", "video cutter no watermark".

### V02 · Compress Video — `compress-video`
**Does:** Make a video smaller: by target size, by quality, or by preset.
**Runtime:** hybrid. Browser via WebCodecs; server (ffmpeg, two-pass) above browser limits or on request.
**Controls:** mode (Target size: 8 MB / 10 MB / 25 MB / 50 MB / 100 MB / custom — labelled for Discord, email, WhatsApp; Quality: High/Medium/Small; Advanced: resolution, fps, bitrate, codec H.264/H.265 where supported/AV1), remove audio toggle.
**Behaviour:** target-size mode computes video bitrate = (target × 0.97 × 8 / duration) − audio bitrate; if the result is too low for the resolution (< ~0.05 bits per pixel per frame), auto-suggest lower resolution. Shows estimated output before start.
**Tests:** 200 MB 1080p 2-min → target 25 MB lands within 24–25 MB; plays everywhere.
**SEO:** "compress video" · "compress video for discord", "reduce video size", "compress mp4".

### V03 · Video Converter — `video-converter`
**Does:** Change container/codec (MOV→MP4, MKV→MP4, WebM↔MP4, AVI→MP4…). Powers video pair pages.
**Runtime:** hybrid (server for unusual codecs like ProRes/DNxHD inputs and large files).
**Controls:** output format (MP4, WebM, MOV, MKV), codec where relevant, "keep quality (remux if possible)".
**Behaviour:** if input codecs are already compatible with the target container, remux (instant). Otherwise re-encode.
**Tests:** MOV (H.264) → MP4 is a remux (no re-encode, identical frame hashes); MKV (VP9) → MP4 re-encodes to H.264.
**SEO:** "video converter" · "mov to mp4", "mkv to mp4", "webm to mp4".

### V04 · Video to GIF — `video-to-gif`
**Does:** Clip → animated GIF (and animated WebP option).
**Controls:** range (Timeline), fps (5–30, default 12), width (default 480), loop count, speed, quality (palette per frame vs global, dithering), output GIF/WebP.
**Behaviour:** two-pass palette generation with the in-house quantiser (keeps ffmpeg.wasm out of the launch set; ffmpeg.wasm palettegen can be compared later); shows estimated size; warns above 15 MB.
**Tests:** 5 s at 12 fps → 60 frames; dims correct; loops.
**SEO:** "video to gif" · "mp4 to gif", "make gif from video".

### V05 · GIF to MP4 — `gif-to-mp4`
**Does:** Animated GIF → MP4/WebM (much smaller, for social/web).
**Controls:** loop N times, background for transparency, output format.
**Tests:** frame timing preserved (variable GIF delays mapped correctly).
**SEO:** "gif to mp4" · "convert gif to video".

### V06 · Extract Audio from Video — `extract-audio`
**Does:** Pull the audio track out as MP3/WAV/M4A/AAC/FLAC/OGG.
**Controls:** format, bitrate (MP3/AAC), sample rate (keep/44.1/48 kHz), track picker if multiple audio tracks, range (optional).
**Behaviour:** if target = source codec (AAC → M4A), copy without re-encode.
**Tests:** MP4 AAC → M4A is a copy; MP4 → MP3 320 kbps duration ±10 ms.
**SEO:** "extract audio from video" · "mp4 to mp3", "mov to mp3", "video to audio".

### V07 · Mute Video — `mute-video`
**Does:** Remove audio (stream copy — instant). Option: mute only a range (re-encodes audio only).
**Tests:** output has no audio stream; video stream byte-identical.
**SEO:** "remove audio from video" · "mute video".

### V08 · Video Info & VFR Check — `video-info`
**Does:** Show everything about a file: container, codecs, profile/level, resolution, SAR/DAR, fps (and whether it's **variable**), bitrate, duration, colour space/range/transfer (HDR?), audio format, channels, sample rate, rotation, creation date, encoder; export as text/JSON.
**Behaviour:** clear verdicts editors care about: "Variable frame rate — may drift out of sync in Premiere. Fix with VFR → CFR." "HDR (HLG) — will look washed out in SDR timelines." Runs fully in browser (mediainfo.js) — reads only headers where possible, so even huge files are instant.
**Tests:** VFR phone fixture flagged VFR; CFR fixture not; HDR fixture reports transfer correctly.
**SEO:** "video metadata viewer" · "check video frame rate", "is my video variable frame rate", "mediainfo online".

### V09 · Resize & Crop Video for Social — `resize-video`
**Does:** Reframe to 9:16, 1:1, 4:5, 16:9 with Fill (crop, draggable framing), Fit with blurred background, or Fit with colour; or exact resolution.
**Controls:** presets (Reels/TikTok/Shorts 1080×1920, Instagram 1080×1350 and 1080×1080, YouTube 1920×1080), framing position (static in Wave 2; keyframed/auto-follow is a future idea), background style.
**Tests:** 16:9 → 9:16 blur-fit exact 1080×1920; framing offset respected.
**SEO:** "resize video for instagram" · "convert video to 9:16", "make video vertical".

### V10 · Extract Frames / Thumbnail — `extract-frames`
**Does:** Grab one frame at a time (thumbnail), every N seconds, N evenly spaced frames, or a contact sheet.
**Controls:** mode, time/interval, format (PNG/JPG/WebP), size; frame-accurate scrubbing in Timeline.
**Tests:** frame at 00:00:05:12 (25 fps) matches reference hash; contact sheet 4×4 layout.
**SEO:** "extract frames from video" · "video to jpg", "get thumbnail from video".

### V11 · Rotate & Flip Video — `rotate-video`
**Does:** 90/180/270 and flips. Fast mode sets the rotation flag (instant, supported by most players); "Burn in" re-encodes for players that ignore the flag (default for 90° to be safe, with a note).
**Tests:** portrait phone video rotated 90° displays upright in all three browsers.
**SEO:** "rotate video" · "flip video".

### V12 · Merge Videos — `merge-videos`
**Does:** Join clips in order.
**Runtime:** hybrid. Same codec/resolution/fps → fast concatenation in browser. Mixed specs → re-encode to a common spec (the first clip's, or chosen); large totals → server.
**Controls:** reorder list, output resolution/fps (for mixed), transition none/crossfade (re-encode).
**Tests:** 3 identical-spec clips → concat without re-encode, total duration exact; mixed 30/25 fps → CFR output without drift.
**SEO:** "merge videos" · "combine videos", "join mp4 files".

### V13 · Change Video Speed — `video-speed`
**Does:** 0.25× – 4× (and custom), audio pitch preserved (or muted/pitched option).
**Tests:** 2× halves duration ±1 frame; audio pitch unchanged (spectral centroid check within tolerance).
**SEO:** "speed up video" · "slow down video", "change video speed".

### V14 · Add or Replace Audio in Video — `replace-audio`
**Does:** Replace the soundtrack, or mix a music bed under the original with volume and fades; trim/loop music to video length.
**Controls:** mode (Replace / Mix), levels, fade in/out, start offset, "duck under speech" (Wave 3 idea — leave out).
**Tests:** output duration = video duration; audio levels as set (±1 dB).
**SEO:** "add music to video" · "replace audio in video".

### V15 · VFR to CFR — `vfr-to-cfr`
**Does:** Convert variable-frame-rate phone/screen recordings to constant frame rate so they stay in sync in NLEs (Premiere, Resolve).
**Runtime:** cpu (ffmpeg, precise frame timing; browser path can be added later if reliable).
**Controls:** target fps (auto = nearest standard: 23.976/24/25/29.97/30/50/59.94/60), quality (visually lossless default), keep audio.
**Behaviour:** reads V08 analysis; if already CFR, says so and does nothing (no charge).
**Tests:** VFR fixture → output CFR (probe shows constant), duration equal ±1 frame, A/V drift < 1 frame over full length.
**SEO:** "convert variable frame rate to constant" · "vfr to cfr", "fix audio sync premiere phone video".

### V16 · Burn Subtitles into Video — `burn-subtitles`
**Does:** Hardsub SRT/VTT/ASS into the picture.
**Runtime:** cpu (ffmpeg libass).
**Controls:** subtitle file (or from V17 handoff), font (bundled OFL, Cyrillic-capable), size, colour, outline, background box, position, max width; ASS styles honoured when ASS input.
**Tests:** subtitles visible at the right timestamps (frame sampling + OCR-free pixel check in the subtitle region).
**SEO:** "burn subtitles into video" · "add subtitles to video permanently", "hardcode srt".

### V17 · Auto Subtitles — `auto-subtitles`
**Does:** Speech → timed subtitles (SRT/VTT/ASS/TXT), 90+ languages including Uzbek, Russian, English; optional translation to English.
**Runtime:** gpu (Whisper-class model). **Audio is extracted in the browser first** and only the audio is uploaded (much faster, less data) — say so on the page.
**Controls:** language (auto/choose), max characters per line (default 42), max lines (2), style for optional burn-in handoff to V16, word-level timestamps toggle.
**Behaviour:** result opens in a light cue editor (shared with T03 when it exists) so users fix words before download; "Burn into video" → V16 handoff.
**Tests:** English, Russian, Uzbek fixtures → WER under a set threshold on the fixture set (record baseline); cue lengths respect limits.
**SEO:** "auto subtitle generator" · "generate subtitles from video", "srt generator", "uzbek subtitles".

### V18 · Reverse Video — `reverse-video` (Wave 3)
Reverse (with/without audio). Browser, chunked to control memory; long clips → warn. **SEO:** "reverse video".

### V19 · Loop Video — `loop-video` (Wave 3)
Repeat N times or to a target duration; boomerang option. Fast concat when possible. **SEO:** "loop video".

### V20 · Upscale Video — `upscale-video` (Wave 3)
AI 2×/4× (Real-ESRGAN video variant or similar), GPU, per-minute credits, max 4K output, 10 min cap. Free 3-second preview. **SEO:** "ai video upscaler".

### V21 · Video Background Remover — `video-background-remover` (Wave 3)
Person/object matting to transparent (ProRes 4444/WebM alpha) or green screen/colour. GPU, per-minute. Model license must allow commercial use (see `13`). **SEO:** "remove video background".

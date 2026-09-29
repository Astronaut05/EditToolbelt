# Subtitles & Time tools

Read with `docs/02-tool-framework.md`. All run in the browser; all logic in `packages/core` (`subtitles/`, `timecode.ts`, `calc/`) so the Premiere panel reuses it. Engine `text`.

Shared rules:
- Subtitle parsing is tolerant (BOMs, CRLF/LF, missing blank lines, comma or dot milliseconds) but writing is strict and spec-correct.
- Encoding: detect UTF-8/UTF-16/Windows-1251/Windows-1252 and let the user override; always write UTF-8 (BOM optional toggle for old players).
- Frame rates everywhere use exact rationals: 24000/1001, 30000/1001, 60000/1001 — never 23.976 as a float in maths.
- Calculators: live results as you type, shareable state in the URL query (no storage needed), copy buttons.

---

### T01 · Subtitle Converter — `subtitle-converter`
**Does:** Convert between SRT, WebVTT, ASS/SSA, SBV (YouTube), TTML/DFXP (Wave 2 addition if cheap), and plain TXT (text only). Batch.
**Behaviour:** ASS → SRT drops styling but keeps line breaks and optionally converts `{\i1}` to `<i>`; SRT → ASS applies a default style (editable). Report anything dropped ("12 style overrides removed").
**Tests:** round-trip SRT→VTT→SRT is identical; fixture files for each format parse with correct cue counts and times.
**SEO:** "subtitle converter" · "srt to vtt", "vtt to srt", "ass to srt".

### T02 · Subtitle Sync & Shift — `subtitle-shift`
**Does:** Fix out-of-sync subtitles.
**Modes:**
- Shift: move all cues by ± time (ms precision), or from a chosen cue onward.
- Frame-rate rescale: e.g. 23.976 → 25 (PAL speed-up) and back.
- Two-point sync: set the correct time for one early and one late cue → linear fit applied to all (fixes both offset and drift).
**Tests:** two-point sync on a fixture with known offset+drift restores times ±10 ms.
**SEO:** "subtitle sync" · "shift srt timing", "fix subtitle delay".

### T03 · Subtitle Editor — `subtitle-editor` (Wave 3)
**Does:** Edit cues on the shared `Timeline` with the video/audio playing: split/merge cues, drag timing, text edit, find/replace, checks (characters per line, characters per second reading speed, minimum gap, overlaps) with one-click fixes. Also used as the review step after V17/A12.
**SEO:** "online subtitle editor" · "srt editor".

### T04 · Timecode Calculator — `timecode-calculator`
**Does:** Add/subtract timecodes; convert between timecode, frames, seconds, and feet+frames (35 mm, Wave 3); convert timecode between frame rates; duration between two timecodes.
**Frame rates:** 23.976, 24, 25, 29.97 DF & NDF, 30, 48, 50, 59.94 DF & NDF, 60, custom.
**Behaviour:** drop-frame maths per SMPTE 12M (semicolon separator for DF); invalid DF timecodes flagged.
**Tests:** known DF/NDF conversion tables (e.g. 01:00:00;00 @29.97 DF = 107,892 frames).
**SEO:** "timecode calculator" · "frames to timecode", "drop frame timecode calculator".

### T05 · Aspect Ratio Calculator — `aspect-ratio-calculator`
**Does:** Given W×H → simplified ratio and decimal; given ratio + one side → the other; common ratios list (16:9, 9:16, 4:3, 1:1, 4:5, 2.39:1, 1.85:1, 21:9); "fit into" calculator (scale W×H into a box, report letterbox/pillarbox bars); even-number rounding option for video (codecs need even dimensions).
**Tests:** 1920×1080 → 16:9; 2.39:1 at 1920 wide → 803 → rounded even 804 when option on.
**SEO:** "aspect ratio calculator" · "16:9 calculator", "resolution calculator".

### T06 · Bitrate & File Size Calculator — `bitrate-calculator`
**Does:** Size ↔ bitrate ↔ duration (any two give the third), with separate video and audio bitrate; "target file size → needed video bitrate"; common codec reference bitrates (clearly labelled as typical, not rules).
**Tests:** 60 s at 8 Mbps video + 192 kbps audio → 61.44 MB (decimal) and MiB shown too.
**SEO:** "video bitrate calculator" · "file size calculator video", "bitrate to file size".

### T07 · Shutter Angle Calculator — `shutter-angle-calculator` (Wave 3)
Shutter angle ↔ shutter speed at a frame rate (180° rule), plus flicker-safe speeds for 50/60 Hz mains lighting. **SEO:** "180 degree shutter rule calculator".

### T08 · Recording Storage Calculator — `storage-calculator` (Wave 3)
Hours of footage from card/drive size and codec bitrate (and the reverse), with a small editable table of common camera codecs (values labelled "typical, check your camera's manual"). **SEO:** "video storage calculator", "how many hours of 4k on 1tb".

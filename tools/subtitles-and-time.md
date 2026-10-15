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

### T09 · Subtitle Generator — `subtitle-generator` (Wave 2, beta)
**Does:** Speech in a video or recording → SRT, by Gemini (default `gemini-3.5-flash`) with the person's own API key, called from their browser. Nothing goes through our servers; the key stays in the page (and in `localStorage` only if they tick Remember). Decision: `docs/decisions/2026-10-15-subtitles-with-gemini.md`.
**Why not browser-only or V17:** no open model runs Uzbek well enough in a browser, and V17/A12 (Whisper on our GPUs) wait on Modal. Gemini is strong on Uzbek, and with the person's key it costs us nothing.
**How (`packages/core/src/subtitles/captions.ts`, `packages/engines/src/audio/subtitle-generator.ts`):**
- The levels are read once (every 10 ms, as A11). A recording over 110 s goes in clips of about 75 s, each cut in the longest pause available, so word times can't drift far.
- Each clip goes as 16 kHz mono FLAC (inline, under Gemini's 20 MB request limit) with a prompt asking for every word with its start and end, grouped into cues by meaning, and JSON to a schema. The prompt carries the style, the language and script, Uzbek's apostrophe, the glossary, and the last words of the clip before.
- What comes back is read tolerantly and checked, not trusted: times in order and inside the clip (milliseconds sent as seconds are caught); a cue over the style's limit is split at punctuation, then pauses, then the middle; a lone word joins the cue it runs into.
- Cue edges next to a pause snap to where the voice starts or stops (±250 ms, from the levels). Pauses under **Close gaps** (default 1.5 s) are closed, so a cue stays up until the next; longer ones leave the screen empty 0.3 s after the voice stops. No overlaps; every cue at least 0.4 s where there's room.
- A clip whose answer is cut off (MAX_TOKENS) or unreadable is split in two and sent again. Busy and rate-limited answers wait and retry; a request field the model doesn't take is dropped for the rest of the run.
**Styles:** Instagram (default): 2 to 4 words, one line, no period or comma at a cue's end. Phrase: 4 to 7 words, one line. Two lines: up to 2 × 42 characters, punctuation kept.
**Options:** API key (remember on this device), Style, Language (Auto, Uzbek Latin or Cyrillic, Russian, English and others), oʻ/gʻ apostrophe (plain ' or official ʻ), filler sounds (remove or keep), Close gaps under (s), names and terms, Model.
**Tests:** the caption rules and the Gemini client in unit tests (no network); one Playwright test drops a recording, answers for Gemini from a fixture, and checks the SRT's cues, gaps and times.
**SEO:** "subtitle generator" · "auto subtitles uzbek", "srt generator from audio".

# 2026-10-01 · Subtitle Editor (Wave 3)

**Decision:**
- **The checks and their limits:** 42 characters a line, 2 lines, 17 characters a second (line breaks and tags not counted), 5/6 s to 7 s on screen, 83 ms between cues (2 frames at 24 fps), no overlaps, no empty cues. Cues that touch (0 ms apart) pass. The line length, reading speed and gap are settings, for house style guides.
- **Fixes change as little as they can:**
  - Long lines: rewrapped into the fewest, most even lines.
  - Fast or short cues: lengthened into the free time after them, then before them, keeping the gap.
  - Gaps and overlaps: the first cue ends a gap before the next; if that would make it too short, the next starts later.
  - Long cues end at 7 s; empty cues go.
  - A cue with no room stays as it is, still marked. Every fix is one step to undo.
- **Editing:**
  - Split at the playhead: a two-line cue splits between its lines, one line by its words in proportion to the time; the first part ends a gap before the second.
  - Merge joins the texts on two lines.
  - Find and replace is literal (no regular expressions), with match case and whole words.
  - Typing in one cue is one undo step until another edit; up to 200 steps.
- **In the shell:** a `subtitles` preset makes the workspace the editor. The probe reads the file into a `cues` option (JSON) and picks its format for "Save as"; the engine writes that option out. After the first save every edit saves again, so the download always matches the screen. The video or audio is a file option, played in the page; on a video, the cue showing is drawn over it.
- **Phones** get the "works best on a computer" note (`desktopBest`), and the editor still works there.

**Why:** `tools/subtitles-and-time.md` → T03.
**Reverse:** `packages/core/src/subtitles/edit.ts` (rules), `packages/ui/src/tool/SubtitleEditor.tsx` (editor).

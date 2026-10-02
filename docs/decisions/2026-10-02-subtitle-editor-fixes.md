# 2026-10-02 · Subtitle Editor: Read as, fixes with no room, one-word cues, and its own cue strip

**Decision:**
- **Read as** (the shared T rules' override): the file's encoding is found as before and shown with the file when it isn't UTF-8. A "Read as" choice in the editor's bar (UTF-8, Windows-1251, Windows-1252, as the converter offers) reads the text again: each cue still as it came from the file goes back to its bytes and is decoded again, and cues typed or replaced since keep their text. UTF-8 is strict, so a file that isn't refuses it with a note instead of losing characters. UTF-16 files aren't offered it: their timing lines wouldn't read the same.
  - How: each cue carries the encoding it was read in (`read`) until it's edited. The ToolShell's probe can't read the file again when a setting changes, and doing it there would also throw away the edits.
- **Gaps and overlaps:** when the next cue can't start later without dropping under the minimum length, neither cue moves and the issue stays marked. The fix said "fixed" before and left a 1 ms cue.
- **Split** refuses a cue of one word, and says so, instead of making an empty cue.
- **The cue strip stays the editor's own,** not the shared `Timeline` named in T03. `Timeline` edits in/out ranges that never overlap, with I/O keys and frame steps. Cues overlap (that's one of the checks), carry text, and are moved or retimed one at a time by drag or keyboard. The strip uses the same timecode helpers and look.

**Why:** M8 review, findings 9 and 15.
**Reverse:** `rereadCues`, `markRead` and `fixIssue` in `packages/core/src/subtitles/edit.ts`, "Read as" in `packages/ui/src/tool/SubtitleEditor.tsx`. To use `Timeline`, it would need overlapping, labelled blocks.

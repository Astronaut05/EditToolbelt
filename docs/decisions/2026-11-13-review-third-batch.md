# 2026-11-13 · What the independent reviews of the second batch found

**Decision:** two reviewers read the changes of `2026-11-12-review-second-batch.md` after they merged (#165), and a third read the Subtitle Editor's rewrite. What they found is fixed here; one sentence of that file is replaced.

- **The search sheet's file is fetched at the first touch, click or key press on the page**, not only when the button is pointed at or Ctrl goes down (this replaces that sentence). It is then put on the page, closed, so opening it happens in the same turn as the tap that asked. A phone raises its keyboard only for a focus made while the tap is handled, and a fetch between the tap and the focus loses that. The first load still carries none of it.
- **While the sheet is on its way, Esc takes the ask back** and Enter is held. Esc used to reach the page, where it cancels a running tool, and the sheet opened afterwards all the same.
- **A server job made during a cancel is cancelled.** The request that creates the job was stopped by the cancel on the page's side only: the server had made and charged the job, and nothing cancelled it. The request now runs to its end, and the job is cancelled as soon as its id is known.
- **A batch knows it has started** before its rows are drawn (120 ms later), so a second setting changed in that moment restarts it too, and Start can't be pressed twice.
- **A merge on our servers is named as one in the browser is:** after the first file in the current order.
- **The price dialog answers no when the run is stopped** (the page was left), so the run ends and its upload is deleted.
- **The error page no longer says files never left the device.** It replaces every page, and on the Subtitle Generator and after a run on our servers that isn't so. It is announced to screen readers (`role="alert"`).
- **The Subtitle Editor draws one row for one keystroke.** With 1,500 cues it drew every row and every timeline block for each keystroke and for each frame of playback, and read the whole list back from JSON each time. The playhead, the time readout and the caption over the video now read a small clock of their own; rows and blocks are memoised; the list is reused when its own JSON comes back. Measured: 1 row and 1 block per keystroke, none during playback. No virtualisation: it would change keyboard and screen-reader behaviour.
- **Deleting the last cue no longer ends in an error panel.** The redo after an edit waits while there are no cues (`blocked` in the tool's preset), so the editor and its undo history stay.

**Left open:**
- While the last cue is deleted, the download made before is still on offer.
- No test counts the editor's renders: the repo has no DOM test environment, and adding one (jsdom) is a dependency decision. The reviewers measured in throwaway harnesses.
- A search sheet that fails to load closes without a message; the next ask tries again.

**Why:** each is a sequence a reviewer could write down with the code in front of them: a second key press within 120 ms, Esc on a slow connection, a cancel during one request.

**Reverse:** the first-interaction listeners and `mount` in `SearchOverlay.tsx`; `batchStarted` in `ToolShell.tsx`; `ctx.signal` passed to `createJob` again in `apps/web/src/lib/server-jobs.ts`; `createClock`, `CueRow` and `CueBlock` in `SubtitleEditor.tsx` and `cues.ts`.

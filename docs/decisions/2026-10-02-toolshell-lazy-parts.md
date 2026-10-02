# 2026-10-02 · The ToolShell loads tool-specific parts only on the tools that use them

**Decision:** code in the shared ToolShell that only some tools use is no longer in the scripts every tool page loads.
- **Loaded when shown, with `React.lazy`** (like the canvas editor, timeline and colour picker before): the batch list, the combine list (`FileOrder`), the analyzer's fact grid, the `grid` and `checklist` option controls, and the timeline workspace (now `TimelineWorkspace.tsx`, which loads with the Timeline).
- **Loaded on mount and kept in state**, because the shell calls into them while it renders (whether the run is blocked, whether the server offer can start):
  - U02's name checks, folder picker, renames in place and undo (`FolderRename.tsx`), only for a preset with `names`. The drop zone takes the "Open a folder" button as a `folder` slot instead of an `onFolder` callback, so its icon comes with it.
  - The server path's notice, price dialog, terms and error class (`ServerNotice.tsx`), only for a tool with `server`.
- `plural` moves from `server.ts` to `format.ts`.

**Why:** Batch Rename and Watermark Images (PR #71) put about 2.7 KB of their own code into the shell, which took /remove-background past the 180 KB script-transfer budget for tool pages. On the CI build, /remove-background now loads 176,252 bytes of script, down from 181,047, and /video-converter 173,511, down from 178,309 (Lighthouse: 172 KB and 169 KB, down from 177 KB and 174 KB). The budgets are unchanged.
**Reverse:** import those modules statically in `packages/ui/src/tool/ToolShell.tsx` again.

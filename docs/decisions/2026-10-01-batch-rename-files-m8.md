# 2026-10-01 · Batch Rename Files (M8)

**Decision:**
- **Rules in a fixed order, not a chain the user builds:** find and replace, remove, case, prefix and suffix, date, counter, extension. Each is one setting, so the tool fits the shared settings panel; any order a user would build reads the same in this one.
- **Find:** plain text (any case, the default), exact case, or a pattern (a JavaScript regular expression, case-sensitive, `$1` in the replacement). A pattern that doesn't parse says why and stops the rename.
- **Dates:** taken (EXIF DateTimeOriginal in JPG, PNG, WebP and TIFF, as the camera wrote it; an MP4 or MOV's creation time from its movie header), modified, or today. A file with no date taken uses its modified date and the list says so. Only the bytes that hold the date are read.
- **Counter:** start, step, digits, start or end of the name or instead of it, counted as added, by name (numbers as numbers), by date taken or by date modified.
- **Flagged names stop the rename:** two names the same ignoring case (Windows and macOS ignore it), no name left, `\ / : * ? " < > |`, a name Windows keeps (CON, NUL, COM1 …), a trailing dot or space, over 255 bytes. A missing date only warns.
- **Two ways out:**
  - A ZIP of the files under their new names, stored without compression: the bytes are the files' own.
  - In desktop Chromium, "Open a folder" lists its files (not subfolders or hidden files) and, after a confirm, renames them where they are with `FileSystemHandle.move()`. Each file goes to a temporary name first, then its new one, so names that swap or chain never meet; if a move fails, the ones done go back. Undo works while the page is open. Shown only where `showDirectoryPicker` and `move()` exist.
- **The shell gains `preset.names`** (the plan behind the list, and the folder flow), a batch run tells the engine its file's place among the rest (`ctx.batch`), and an engine can set the whole output name (`out.name`). The file list gets a "New name" column, and on phones it drops the size columns and wraps names, so it fits the screen.
- **Up to 1,000 files at once**, any type.
- **The ZIP holds up to 2 GB in all,** and that's the registry's browser limit. It's built in memory (the files, then the archive), and fflate writes no ZIP64, so past 4 GB its sizes and offsets would overflow. Dropped files over 2 GB in all hold the rename, and the page says to rename them where they are in Chrome or Edge on a computer, or to choose fewer. A folder renamed in place has no size limit: no file is read.

**Why:** `tools/utility.md` → U02.
**Reverse:** the rules are `packages/core/src/rename.ts`; the dates `packages/engines/src/files/taken.ts`; the folder rename `packages/ui/src/tool/in-place.ts`.

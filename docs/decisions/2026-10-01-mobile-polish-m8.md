# 2026-10-01 · Mobile: share target, install button, desktop notes (M8)

**Decision:**
- **Android share target:** the manifest's `share_target` takes images, video, audio and subtitle files as a multipart POST to `/share`.
  - The static site has no server, so the service worker answers that POST. It keeps the files (up to 50) in an `etb-shared` cache on the device, clears anything older, and redirects to `/share`.
  - `/share` reads the files, **deletes them from the cache at once**, and lists the tools that take every one of them: open now, run in the browser, and reached without a full page load (the handoff is in memory). Several files list only batch tools when there are any. Batch Rename, which takes any file, comes last.
  - Picking a tool hands the files to it in memory, the way "Use in another tool" does. The handoff now carries several files.
  - iOS has no share target, which is fine (`docs/01`).
- **Install button:** Chrome's `beforeinstallprompt` is kept and an "Install the app" button appears in the footer. It's never a pop-up. One prompt per offer, and the button goes after. On iPhone and iPad Safari, where nothing can prompt, a line says "tap Share, then Add to Home Screen". Neither shows once the app is installed.
- **"Works best on a computer":** tools flagged `desktopBest` (Batch Rename) show "Works best on a computer, and works here too." under the privacy line, below the `lg` breakpoint only.
- **Thumb reach and bottom sheets** were already in place: the primary action sits in a bar at the bottom of the screen on phones, and the settings open as bottom sheets.

**Why:** `docs/12` → M8 (mobile), `docs/01` → Mobile, `docs/03` → Mobile.
**Reverse:** the share target is `apps/web/src/app/manifest.ts`, `scripts/sw.ts` (`receiveShare`) and `src/app/share/`; the install button is `src/components/InstallButton.tsx`; the note is in `ToolShell`'s header.

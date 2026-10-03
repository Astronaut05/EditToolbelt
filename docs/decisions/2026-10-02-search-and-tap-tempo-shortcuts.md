# 2026-10-02 · Search opens with Ctrl+K; T taps only in the tempo panel

**Decision:**
- **Search:** Ctrl+K, or ⌘K on Apple devices, opens the search overlay from any page. On the home page it focuses the hero search instead, as `/` did.
  - It works while typing too, except Ctrl+K in a text field on a Mac, where macOS uses it to delete to the end of the line.
  - When the layout isn't Latin (Cyrillic, for one), the K key is read by its position.
- **`/` stays only while focus is in the site header** (`data-site-header`), not in the phone menu's sheet. Anywhere else it does nothing of ours.
- **The header's Search button shows the shortcut:** "Ctrl K" or "⌘K" in mono, desktop only, hidden from screen readers. The button carries `aria-keyshortcuts="Control+K Meta+K"`.
- **Tap tempo:** T taps only while focus is in the tempo panel: the pad, the panel's buttons, or the panel itself after a click in it. Space and Enter on the pad tap as before.
  - The panel is a labelled group that takes focus on click (`tabIndex=-1`). That keeps T working after a mouse tap in Safari, where buttons don't take focus on click.
  - A held key doesn't repeat taps, and T in the metronome's fields types as usual.
  - The pad's hint now reads "Tap along 4 times or more, or focus the pad and press T."
- **Supersedes** the `/` shortcut in "Search loads on first use" (2026-09-29) and the T key in "BPM & Key Finder (A03)" (2026-09-30), both in [`../DECISIONS.md`](../DECISIONS.md).

**Why:**
- WCAG 2.1.4 (Level A, rule 9) needs a single-character shortcut to be switchable off, remappable, or active only while its component has focus (final web review, S7).
- Both handlers sat on `window`, so a speech-input user saying a word with "t", or a stray "/", set them off.
- Ctrl+K is the common search shortcut (GitHub, Slack, docs sites). A shortcut with a modifier is outside 2.1.4. An off switch would have been one more setting nobody finds.

**Reverse:**
- Search: `isSearchShortcut` and `isHeaderSlash` in `packages/ui/src/layout/SearchOverlay.tsx`, and `data-site-header` in `packages/ui/src/layout/Header.tsx`.
- Tap tempo: `onPanelKey` in `packages/ui/src/tool/TempoTools.tsx`. Put back a `window` listener to tap from anywhere.
- Tests: `apps/web/e2e/keyboard.spec.ts`, `security.spec.ts` and `audio.spec.ts`.

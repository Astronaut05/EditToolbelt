# Design handover: direction C "Signal"

Signed off by Astro on 2026-09-30. Made with the `/design-taste-frontend` design round. This folder is the visual source for M1. Build to match it, using the component names in `docs/03-design-system.md`.

| File | What it is |
|---|---|
| `tokens.css` | Every colour, type, space, radius and layout token, in light and dark. Copy into `packages/ui/tokens.css`. |
| `screens/*.png` | The target screens, pixel-exact at 1440 px (desktop) and 390 px (phone), light and dark. |
| `reference-html/*.html` | The static mockups the PNGs were rendered from. Use them for measurements only: absolute-positioned throwaway HTML, not code to copy. They name the fonts but don't embed them; self-host Onest and IBM Plex Mono as `03` says. |

## The look in one paragraph

Near-black (or white) ground, hairline dividers instead of boxes, and one lime accent used only for the primary action, the current selection and status dots. Headlines are big and tight (Onest 650, tracking −0.035em). Every technical fact (sizes, pixels, formats, counts, timecodes) is set in IBM Plex Mono, and small labels are uppercase mono with +0.14em tracking. Corners are sharp: 4 px on controls, 0 on the preview. On desktop the tool page splits into a settings column and a preview that bleeds to the right edge of the window.

## Rules that make it "Signal" (keep these when designing anything not drawn here)

1. **The accent appears only in these places:** the primary button, the selected option's 2 px underline, status dots, the search-hit highlight and the text caret. No accent backgrounds on cards, no accent headings.
2. **Hairlines over boxes.** Lists and settings are rows separated by 1 px `--border` lines. Panels with borders are the exception: the drop zone and the "Until then, try" list. Form fields (inputs, selects, text areas, switches, colour wells) are outlined in `--border-field`, which holds 3:1 against the page (WCAG 1.4.11).
3. **Selection is never shown by colour alone.** The selected option is `--text` + weight 600 + a 2 px accent underline; unselected is `--text-muted` + weight 400.
4. **Numbers are mono,** and so are units. Uppercase mono is for labels, not for sentences.
5. **Overlays on images and video are always dark** (`--media-*` tokens), in both themes, because they sit on arbitrary pixels.
6. **Maximum 3 text levels per region:** heading, body, mono label.
7. **No em or en dashes in UI copy, no filler words, no drop shadows or glows.** The only elevation is the media scrim.
8. **Focus:** 2 px `--focus-ring` outline with 2 px offset on every interactive element. Tab order follows reading order: left column, then preview.

## Screens → components

### Tool page (`tool-empty`, `tool-progress`, `tool-result`), all rendered by `ToolShell`

```
┌ Header (56) ─────────────────────────────────────────────────────────────┐
├──────────── left column 560 ────────────┬────────── preview (fluid) ──────┤
│ Breadcrumb (mono label)                 │                                 │
│ H1 (46/650)  + tagline (18, muted)      │  DropZone      (empty state)    │
│ PrivacyBadge (dot + one line)           │  CanvasPreview + BeforeAfter    │
│ OptionsPanel: rows [label | SegmentedControl]  (result state)            │
│   last row = read-only fact (mono)      │  ProgressBar overlay (running)  │
│ ResultActions: [Download · primary][Start over / Cancel]  Readout overlay │
│ "Next:" = Use-in-another-tool links     │  (bottom-left, media scrim)     │
│ HowTo list (empty state only)           │                                 │
└─────────────────────────────────────────┴─────────────────────────────────┘
```

| Region | Component (from `03`) | Notes |
|---|---|---|
| Header | `Header` | Wordmark, category nav (current = `--text`), search trigger, "Sign in" after a hairline divider. Height 56, bottom hairline. |
| Breadcrumb | part of `ToolShell` | Mono label, "Photo / Remove Background". |
| H1 + tagline | `ToolShell` from registry `seo.h1` / `tagline` | H1 breaks onto 2 lines in the 480 px text width, which is intended. |
| Privacy line | `PrivacyBadge` | Client runtime: accent dot + "Runs in your browser. Your image never leaves your device." Server runtime: same layout, `--text-muted` dot, "Processed on our servers, deleted within 1 hour." |
| Settings rows | `OptionsPanel` + `SegmentedControl` | Row height 54, hairline below. Label left in `--text-muted`, options right-aligned. Read-only facts (e.g. AI model) in mono. |
| Drop area | `DropZone` | Fills the preview area; 1 px dashed `--border` inset 24 px; mono "STEP 1", 46 px heading, key hints as mono `kbd`, primary "Choose image" + secondary "Try a sample", accepted formats as a mono line. |
| Preview | `ResultPanel` → `BeforeAfter` | Fills the right side edge to edge, full height below the header. Checkerboard uses `--checker-*`. "Original"/"Result" tags use the media scrim. |
| Facts strip | `ResultPanel` readout | Bottom-left over the image, media scrim, mono uppercase, cells split by hairlines; the last cell (engine path) is in `--media-accent`. |
| Progress | `ProgressBar` | Bottom overlay on the preview, media scrim. Title (17/600) + mono % on the right, 4 px track with accent fill, mono meta row: bytes, step, elapsed. While running, the Download button is disabled (38% opacity) and "Start over" becomes "Cancel · ESC". |
| Download | `ResultPanel` primary action | 52 px tall, accent fill, label includes the size: "Download PNG · 3.1 MB". |
| "Next:" links | "Use in another tool" handoff | 2–3 related tools from the registry `related`, underlined with the accent. |

### Home (`home-*`)

The search line **is** the hero: a mono question label, the query in 72 px type with an accent caret, a 2 px `--border-strong` rule, then the top 3 matches in one row (first match in accent). Below: "Most used" as two numbered mono lists (01–10), and Categories with mono counts plus the one-line product description. Search is instant and client-side over the registry. Before anything is typed, show the placeholder "What do you need to do?" in 72 px `--text-muted` (full strength since 2026-10-02: 45% opacity was 1.9:1, below WCAG 1.4.3). While the input has focus, the 2 px rule under it turns `--focus-ring` and 4 px thick.

### Category hub (`hub-photo-*`)

72 px H1 "Photo tools", lead text, and filter tabs on the right (All / In browser / AI, with mono counts), then the 2 px rule. Tools are numbered rows in two columns, each with name, one line and a mono runtime tag (`BROWSER`, `AI · BROWSER`, `AI · CREDITS`). `soon` tools come last, dimmed, tagged `SOON`, and are not links. The footer (same on every page): wordmark and one line, Tools, Legal (Privacy, Terms, Refunds, Cookies, Open-source licenses), Contact, then a mono bottom line.

### Coming-soon page (`soon-upscale-*`), `noindex`

Left: breadcrumb, H1, a mono `COMING SOON` tag, tagline, and a numbered "what it will do" list from the tool spec. Right: a hatched panel (1 px diagonal lines in `--border` on `--surface`) with "Until then, try" and 3 related **live** tools as big rows with arrows.

### Phone (`phone-empty-*`, `phone-result-*`)

- **Empty:** header 52, breadcrumb, 34 px H1, tagline, privacy line, then one big accent tap area ("Choose an image", 210 px tall) with a two-cell row under it (Camera / Try a sample) and the formats line.
- **Result:** the image preview goes full-bleed at the top with a mono facts strip under it, then a title ("Background removed") and settings collapsed into tappable rows that open a bottom sheet. A sticky bottom bar holds Download (primary) and Start over, per `03` Mobile.
- Minimum touch target is 44 px everywhere.

## Not drawn yet: design them with the rules above

- **States:** hover (text goes to `--text`, underline on links), pressed, disabled (38% opacity, no pointer), error. For errors use `ErrorState` in the preview area with the same layout as the empty state: mono "COULDN'T READ THIS FILE", a 32 px heading saying what happened, one line on what to do, and a retry button. Don't use red backgrounds; only a `--danger` dot.
- **Other shells:** `CanvasEditor`, `Timeline`, `BatchList`, calculator tools (inputs left, live results right in mono), server-tool `PriceConfirm` (same row style: "This will use 6 credits · you have 120").
- **Other pages:** legal pages (single 720 px text column, 46 px H1, body 16/1.6), `/developers`, account, admin (dense, `D`=8, same tokens).
- **Search overlay,** opened by `/` or the header search: a full-width sheet under the header with the 72 px input and the result list.

## Changes to `docs/03-design-system.md` this implies

- Radius: 4 px controls and cards, 0 on the preview (was 6/12/16).
- Type scale adds 18, 46 and 72; H1 weight is 650.
- Home and hub H1s use 72 px. The dials in `03` still hold for the layout's calm density (tool page V2/D5), with type drama higher than planned (T5 instead of T3). That's the "Signal" choice.
- Logo: the wordmark "Edit**Toolbelt**" (second word in accent) is a **placeholder** until open question 1 (logo) is decided.

## Contrast check (WCAG 2.2 AA)

| Pair | Dark | Light |
|---|---|---|
| `--text` on `--bg` | 17.7 | 19.8 |
| `--text-muted` on `--bg` | 5.9 | 5.3 |
| `--text-muted` on `--surface` | 5.6 | 4.9 |
| `--accent-contrast` on `--accent` | 13.0 | 5.8 |
| `--accent` on `--bg` (UI, 3:1 needed) | 13.0 | 5.8 |
| `--danger` / `--warning` on `--bg` | 7.1 / 10.7 | 5.8 / 5.9 |
| `--border-field` on `--bg` / `--surface` (form fields, UI, 3:1 needed; added 2026-10-02) | 3.7 / 3.5 | 3.7 / 3.4 |

All pairs pass. CI's contrast check on the token table should reproduce these numbers.

## M1 sign-off checklist (design part)

- [ ] Every screen in `screens/` is reproduced in Storybook/Ladle or on a real route, in light and dark, and matches at 1440 and 390 px.
- [ ] Only the places listed in rule 1 use the accent.
- [ ] Keyboard: everything reachable, focus visible, `Esc` cancels, `/` opens search.
- [ ] No AI tells from `03` → "AI tells".

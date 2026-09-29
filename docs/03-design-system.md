# 03 — Design system

One look across every page, every tool, every surface. Built once in `packages/ui`, consumed everywhere. The Premiere panel reuses the tokens (not the React components — UXP has its own widget set; match colours/spacing/type).

## Principles

1. **The tool is the page.** Above the fold on every tool page: H1, one line, and the drop zone/workspace. No hero images, no marketing blocks above the tool.
2. **Zero-to-result in one action.** Sensible defaults so dropping a file and pressing one button gives a good result. Options are there but collapsed under "More options" unless essential.
3. **Show the numbers.** Dimensions, file sizes before→after, duration, fps, LUFS, bitrate — editors trust numbers.
4. **Calm, tool-like, dark-friendly.** Editors live in dark apps. Dark theme is a first-class citizen, not an afterthought.
5. **No surprises.** Never upload without consent, never charge without a confirm, never lose work on navigation (warn if a result hasn't been downloaded).

## Tokens

Defined as CSS custom properties in `packages/ui/tokens.css`, mirrored in Tailwind config. Components use tokens, never raw hex.

- **Colour roles:** `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, `--success`, `--warning`, `--danger`, `--focus-ring`. Category tints for hub cards and icons: `--cat-photo`, `--cat-video`, `--cat-audio`, `--cat-color`, `--cat-time`, `--cat-utility` (used sparingly: icon backgrounds, small tags).
- **Themes:** light and dark, follow system by default, manual toggle stored locally (strictly-necessary preference, see legal doc). Every token pair must pass WCAG AA contrast (4.5:1 text, 3:1 UI) — CI runs a contrast check on the token table.
- **Type:** **Onest** (variable 100–900, OFL) for all UI, **IBM Plex Mono** (OFL, 400/500) for timecodes and numeric readouts. Both cover Uzbek Latin `ʻ` (U+02BB) and Uzbek Cyrillic қ ғ ҳ ў; Onest has tabular figures (`tnum`). Inter, Roboto, Arial and system fonts are not used (taste rules below). Self-hosted font files (no Google Fonts requests — privacy and speed). Tabular numerals for all numbers.
- **Scale:** type 12/14/16/20/24/32/40; spacing 4-pt grid (4, 8, 12, 16, 24, 32, 48, 64); radius 6 (controls) / 12 (cards) / 16 (workspace); one elevation level + one for dialogs.
- **Motion:** 120–200 ms, ease-out; progress and state changes only; everything disabled under `prefers-reduced-motion`.
- **Icons:** one open-licensed icon set (Lucide, ISC) — no mixing sets. Each tool has an icon in the registry.

Visual direction (logo, accent colour) comes from the `/design-taste-frontend` design round in M1 (below). Until it's signed off, build with a neutral placeholder accent; tokens make the swap a one-file change.

## Visual direction and taste rules (from `/design-taste-frontend`)

Astro's `/design-taste-frontend` skill (adapted from Leonxlnx/taste-skill) is the design source for EditToolbelt. It runs in claude.ai chat, not in Claude Code, so its rules for UI are restated here.

**Where the skill itself is used** (non-Uzcosmos project: open fonts, no Uzcosmos logo, never TT Hoves):
1. **M1 look.** Run the skill's *design round only*: 2–3 genuinely different directions for the home page and one tool page (Remove Background), rendered at 1440×900 and 390×844, light and dark. Astro picks one; its colours, type scale and spacing become `tokens.css`. The skill's final round (generated background, logo stamp) doesn't apply to UI.
2. **Marketing graphics.** OG image template, covers for the Shorts/Reels demo videos, Product Hunt and directory visuals (see `09`).

**Dials for pages** (VARIANCE / DENSITY / TYPE DRAMA, 1–10, as in the skill):

| Page | V | D | T |
|---|---|---|---|
| Tool page | 2 | 5 | 3 |
| Category hub | 3 | 6 | 4 |
| Home | 4 | 4 | 5 |
| Admin | 1 | 8 | 2 |

The tool is the page, so tool pages are calm, aligned and dense with real numbers; drama belongs to marketing graphics, not the workspace.

**Taste rules for the UI:**
- **Type:** max 2 families (Onest + IBM Plex Mono). Hierarchy by weight, size and case, not a third font. Display sizes: tracking −1 to −3%, line-height 0.95–1.05. All-caps micro-labels: +12 to +20% tracking. Uzbek Latin always uses `ʻ` (U+02BB), never an apostrophe or backtick.
- **Colour:** neutral base + **one locked accent**, saturation under 80%. Category tints stay small (icon backgrounds, tags). No AI-purple or blue neon glows, gradient text, rainbow meshes, outer glows or glassmorphism.
- **Layout:** one strong alignment edge per view; at most 3 hierarchy levels inside a panel; negative space is deliberate, not leftover.
- **Copy:** no "Elevate", "Unleash", "Next-gen", "Revolutionary", "Supercharge" or similar filler. Numbers are real (our limits, formats, speeds) or clearly marked placeholders. No em or en dashes in UI copy: use a period, comma or colon; ranges use a hyphen (2-4 MB).

**AI tells (fail the M1 review and any UI PR):**
- Everything centred, with no alignment edge.
- Three equal icon boxes in a row ("Fast · Private · Free"). The "Why use this" section in `09` is three short lines of text, not three cards.
- Drop shadows or glows behind text, bevels, gradient headlines.
- Generic "AI" hero art, stock gradients, lorem ipsum or fake numbers in anything Astro reviews.
- Every hub or tool page looking like a template with the words swapped: the shell is shared, the copy and sample file are not.

## Layout

- **Header:** logo, category menu (Photo, Video, Audio, Color, Subtitles & Time, Utility), search (instant, client-side over the registry: name, secondary queries, tags), credits balance + account (when signed in) or "Sign in".
- **Tool page:** single column, max content width 1200 px; workspace can go full width for `canvas-editor` and `timeline`. On ≥1024 px the options panel sits right of the preview; below that it stacks under.
- **Hub page per category:** grid of tool cards (icon, name, one line, runtime badge "In-browser" / "AI · credits"), "soon" cards greyed at the end.
- **Home:** search box first, then the most-used tools (from analytics; start with a fixed list), then categories.
- **Footer:** categories, legal links (Privacy, Terms, Refunds, Cookies, Open-source licenses), contact, language (later).

### Mobile (≤ 640 px)
- Bottom-anchored primary action button ("Remove background", "Download") within thumb reach.
- Drop zone becomes a large "Choose file" button; also accepts camera/gallery.
- Options open in a bottom sheet.
- Minimum touch target 44×44 px.
- Timeline and canvas editor use pinch-zoom and larger handles; tools flagged `desktopBest` show a short note but still work.

## Shared components (build in milestone 1, before any tool)

| Component | Notes |
|---|---|
| `ToolShell` | See `02-tool-framework.md`. |
| `DropZone` | Drag, click, paste, multiple, accept filter, size check, "or try a sample file" link (samples in `public/samples/`). |
| `OptionsPanel` | Renders controls from a preset's option schema: number with unit, slider, segmented control, select, toggle, colour, preset picker. Generated from Zod schema metadata where possible. |
| `PresetPicker` | Named presets with icons (Instagram Story, YouTube thumbnail, 4K, Discord 10 MB…). Custom values always possible. |
| `ProgressBar` | Determinate/indeterminate, stage label, elapsed, cancel. |
| `ResultPanel` | Preview, before/after slider (images), player (audio/video), size diff, download, "Use in another tool", start over. |
| `BeforeAfter` | Slider comparison for images; A/B toggle for audio. |
| `CanvasEditor` | Photo editor: crop (free / ratio presets / exact px), resize, rotate 90° and free angle, flip, draw (brush, line, arrow, rectangle, highlighter), text, blur/pixelate brush, undo/redo (50 steps), zoom/pan, export format/quality. Modes are turned on/off by preset — "Crop image" opens with only crop active but the others one tap away. |
| `Timeline` | For audio/video: waveform (audio) or thumbnail strip (video), playhead, in/out handles, multiple cut ranges, fades, zoom, snapping to frames (video) or zero-crossings (audio), keyboard (J/K/L, I/O, arrows by frame). Also hosts subtitle cues in the subtitle editor. |
| `BatchList` | Per-file row: name (local only), size, status, result size, download; "Download all (ZIP)" built client-side. |
| `CreditBadge` / `PriceConfirm` | "This will use 6 credits (you have 120)". |
| `CapabilityNotice` | Explains when a browser can't do something and offers the alternative. |
| `EmptyState`, `ErrorState`, `Toast`, `Dialog`, `Tabs`, `Tooltip`, `Tag`, `Card`, `Button`, `Input`, `Select`, `Slider`, `Switch`, `SegmentedControl`, `ColorInput`, `NumberWithUnit` | Standard set, all keyboard accessible. |

Storybook (or Ladle) for `packages/ui` with every component in light/dark, used in milestone 1 review.

## Copy rules

- Button labels are verbs + object: "Remove background", "Download PNG", "Trim video".
- Errors say what happened and what to do: "This file isn't a video we can read. Try MP4, MOV or WebM."
- No "Oops", no exclamation marks in errors, no dark patterns ("No thanks, I like paying more").
- Units always shown; sizes in KB/MB/GB with one decimal.

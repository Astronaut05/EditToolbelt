# 2026-10-02 · Form fields get their own border token; the search line meets contrast

**Decision:**
- **New colour token `--border-field`:** `#858585` in light, `#6B6B6B` in dark (Tailwind `border-border-field`, named like `border-border-strong`).
  - Light: 3.69:1 on `--bg` and `--surface-raised`, 3.41:1 on `--surface`.
  - Dark: 3.72:1 on `--bg`, 3.52:1 on `--surface`, 3.33:1 on `--surface-raised`.
- **It's for form controls only,** where the border is the only boundary: `Input`, `NumberWithUnit`, `Select`, `ColorInput`, the `Switch` track when off, Timeline's In and Out, the subtitle editor's fields, ToolShell's text areas, the text tool's text box, the calculators' fields and the admin forms. `--border` stays the hairline for dividers, cards, panels, buttons and key hints, so the page keeps its calm look.
- **States stay apart:** hover and focus turn the border `--text` (5.4:1 against `--border-field` in light, 4.8:1 in dark), and focus adds the usual 2 px `--focus-ring` outline.
- **CI holds it:** `PAIRS` in `packages/ui/src/contrast.ts` checks `--border-field` on `--bg`, `--surface` and `--surface-raised` at 3:1 in both themes. The token is mirrored in `packages/ui/theme.css` and `docs/design/tokens.css`, and listed in `docs/03` and the design README's contrast table.
- **Search placeholders** (home and the overlay) use `--text-muted` at full strength: 5.3:1 in light, 5.9:1 in dark. They were at 45% opacity: 1.9:1 and 2.1:1.
- **The home search line shows focus:** while its input has focus, the 2 px rule under it turns `--focus-ring` and 4 px thick. The padding shrinks by 2 px, so nothing moves. The overlay's rule does the same. Before, the caret was the only cue (`outline-none`).

**Why:** rule 9 (WCAG 2.2 AA), from the final web review:
- **S6:** field borders were `--border`, 1.27:1 in light and 1.31:1 in dark against the page, below 1.4.11's 3:1.
- **Nit 1:** the placeholders were below 1.4.3 even as large text (3:1), and the home input had no visible focus indicator except the caret (2.4.7).
- These are the lightest greys that keep 3:1 with some margin on every ground a field sits on. `--text-muted` would pass too, but fields would then outweigh the hairline layout.
- A focus outline around the 72 px input would show on every desktop visit, because the input takes focus on load. Recolouring the rule keeps the handover's look and uses the focus colour.

**Reverse:**
- Drop `--border-field` from `packages/ui/tokens.css`, `packages/ui/theme.css`, `docs/design/tokens.css` and `PAIRS`, then replace `border-border-field` with `border-border` (grep).
- Placeholders: back to `placeholder:text-text-muted/45`. The rule: drop the `focus-within:` classes in `apps/web/src/components/HomeSearch.tsx` and `packages/ui/src/layout/SearchOverlay.tsx`.

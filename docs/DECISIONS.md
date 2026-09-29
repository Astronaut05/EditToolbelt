# Decisions

Calls made without Astro while working autonomously (`CLAUDE.md` rule 10), newest last. Each entry: date, decision, why, how to reverse. Earlier decisions (M0 and its sign-off) are in `CHANGES.md`.

## 2026-09-29 · Autonomous mode starts

**Decision:** From now until the M2 local launch, work continues through M1a, M1b, M2 and M2b without waiting for sign-off. Checkpoints: (1) M1a skeleton clickable, (2) M1 done, (3) M2 local launch ready to stress-test. `CLAUDE.md` rules 6 and 10 and the header of `docs/14-open-questions.md` say so.
**Why:** Astro's instruction of 2026-09-29.
**Reverse:** restore rule 10 ("Milestone gates") and the "stop and ask" lines from git history.

## 2026-09-29 · One PR at a time through the session branch

**Decision:** Every topic PR is opened from `claude/youthful-ramanujan-1xzkfr`. After it squash-merges, the branch restarts from the new `main` for the next topic. PRs are therefore sequential, not parallel.
**Why:** this session's git access can push that branch only; pushing or deleting any other branch is refused (HTTP 403, organization policy). One topic per PR still holds.
**Reverse:** allow the session to push other branches; then use one branch per topic (`feat/…`, `docs/…`).

## 2026-09-29 · `docs/design-handover` was already merged

**Decision:** The design handover PR was opened and squash-merged as #5 before autonomous mode began, so there was nothing left to open. The branch itself stays: deleting it is refused (HTTP 403, same policy).
**Why:** the design files are on `main` since c7fdf33.
**Reverse:** nothing to reverse. To clean up, delete `docs/design-handover` in GitHub → Branches, or turn on Settings → General → "Automatically delete head branches".

## 2026-09-29 · Repository name in API calls

**Decision:** GitHub API calls keep using `Astronaut05/EditBench`. GitHub redirects that name to `Astronaut05/EditToolbelt`.
**Why:** this session's GitHub access is scoped to the old name, and calls with the new name are refused.
**Reverse:** re-scope the session to `Astronaut05/EditToolbelt`.

## 2026-09-29 · Registry fields beyond `02`

**Decision:** The registry schema adds `summary` (hub-row line, ≤ 48 chars), `willDo` (2-4 lines for the coming-soon page) and `crossOriginIsolated`; `engine` becomes `engines[]`, because hybrid tools have a client and a server engine (P07 is `image-ml` + `image-ml-server`). `accepts`, `outputs`, `limits`, `howTo` and `faq` are optional for `soon` tools and required for `live`/`beta`. `02` is updated to match.
**Why:** the design's hub rows and coming-soon page show a short line and a numbered "what it will do" list; `soon` tools have no real limits or FAQs yet, and inventing them would break the "numbers are true" rule.
**Reverse:** drop the fields from `schema.ts` and the entries, or make the optional ones required.

## 2026-09-29 · Tool copy written from the specs

**Decision:** All 75 entries were written from `tools/*.md`: SEO queries from each **SEO:** line, `willDo` from **Does/Controls**, numbers as the spec gives them. Where the spec's H1 phrase differs from the tool name (P12 "Instagram Image Resizer", P18 "JPG to PDF" …), the H1 follows the primary query. Where the design names a tool or its hub line differently (V06 "Extract Audio", P02 "Free, ratio presets or exact px" …), the design wins. Credit prices are not printed in copy (the README calls them placeholders); server tools are never called free.
**Why:** `09` → Page template (H1 = primary search phrase); the design is signed off.
**Reverse:** edit the entries in `packages/registry/src/tools/`.

## 2026-09-29 · Hub order, runtime tags and "AI"

**Decision:** Hubs list working tools first and `soon` tools last, each group by wave, then README order. A tool is "AI" when one of its engines is an ML engine, so P12 Blur (automatic face detection) counts: the photo hub's AI filter shows 4, not the design fixture's 3. Runtime tags: `BROWSER`, `AI · BROWSER`, `AI · CREDITS`, `CREDITS`. "Most used" on the home page is the design's fixed list until analytics can rank tools.
**Why:** `02` → Status behaviour; truthful counts; `03` → Layout ("start with a fixed list").
**Reverse:** `hubOrder`, `isAi`, `runtimeTag` and `MOST_USED` in `packages/registry/src/index.ts`.

## 2026-09-29 · Search

**Decision:** Search ranks exact phrase > phrase prefix > contains > all typed words (the last may be half-typed) over the tool name, primary query, secondary queries and H1. A tool ranks above the conversion pairs it powers, which reproduces the home design ("mp4 to gif": Video to GIF, MP4 to GIF, GIF to MP4). Conversion pairs join the index only once their tool is live or beta. Search results link to `soon` placeholder pages; hub rows for `soon` tools are not links (design and `02`).
**Why:** the design's example result order; `12` → M2 (pair pages only for live tools).
**Reverse:** `packages/registry/src/search.ts`.

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

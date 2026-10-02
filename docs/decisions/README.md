# Decisions, one file each

Calls made without Astro (`CLAUDE.md` rule 10), from 2026-10-02 on. The ones before are in [`../DECISIONS.md`](../DECISIONS.md).

- **One file per decision:** `YYYY-MM-DD-short-slug.md`, so the newest sort last.
- **The file:** a `# YYYY-MM-DD · Title` heading, then **Decision:**, **Why:** and **Reverse:**, as in `DECISIONS.md`.
- **Superseding one:** the new file says which it replaces, and the old one gets a line at its end pointing to the new file.
- **Why files:** every pull request used to append to the end of `DECISIONS.md`. Two open PRs always conflicted there, and each conflict cost a full CI run. Separate files never collide.

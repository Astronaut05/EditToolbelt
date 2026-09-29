# Status

**Milestone:** M1b, the rest of M1 · **M1 about 65 % done** · autonomous mode until the M2 local launch (`CLAUDE.md` rule 10)

## Done

- M0 foundations (#4), design handover "Signal" (#5), open question 19 (#6).
- Autonomous-mode rules, `docs/DECISIONS.md`, this file (#7).
- Tool registry: all 75 tools with search, conversion pairs and the COOP/COEP route list (#8).
- Design system: Signal tokens mirrored in Tailwind, every shared component, ToolShell for all six `ui` types against a dummy engine (#9).
- Clickable skeleton: home with instant search, 6 hubs, 75 `soon` pages, header, footer, search overlay, legal stubs, `/licenses`, 404. The design screens are rebuilt in the workshop and match the PNGs at 1440 and 390 px, light and dark (#10, #11).
- Security headers (`_headers`, applied by `pnpm preview`), a hash-based CSP on every page with zero violations, COOP/COEP on `/video-converter`.

## Next

1. M1b: SEO metadata (JSON-LD, sitemap, robots, OG images), PWA, cookieless analytics, component gallery, Playwright with axe, Lighthouse budgets. Then checkpoint 2.
2. M2 launch set (15 tools), then M2b. Then checkpoint 3.

## Blocked

- Nothing blocks the work. Housekeeping only: `docs/design-handover` can't be deleted from this session (HTTP 403); see `docs/DECISIONS.md`.

## Run it

```sh
git pull && pnpm install
pnpm preview                   # production build: http://localhost:4173
pnpm workshop                  # design screens: http://localhost:4173/workshop
docker compose up --watch      # dev stack: http://localhost:3000
```

# Status

**Milestone:** M1a, clickable skeleton · **about 25 % of M1a done** · autonomous mode until the M2 local launch (`CLAUDE.md` rule 10)

## Done

- M0 foundations (#4), design handover "Signal" (#5), open question 19 (#6).
- Autonomous-mode rules, `docs/DECISIONS.md`, this file (#7).
- Tool registry: all 75 tools with search, conversion pairs and the COOP/COEP route list.

## Next

1. Design system: Signal tokens mirrored in Tailwind, self-hosted fonts, shared components.
2. Web skeleton: home with search, 6 hubs, 75 `soon` pages, header, footer, legal stubs, 404. Then checkpoint 1.
3. M1b: component gallery, PWA, CSP and COOP/COEP headers, cookieless analytics, Playwright with axe, Lighthouse budgets. Then checkpoint 2.
4. M2 launch set (15 tools), then M2b. Then checkpoint 3.

## Blocked

- Nothing blocks the work. Housekeeping only: `docs/design-handover` can't be deleted from this session (HTTP 403); see `docs/DECISIONS.md`.

## Run it

```sh
git pull
docker compose up --watch      # dev stack: http://localhost:3000
pnpm install && pnpm preview   # production build: http://localhost:4173
```

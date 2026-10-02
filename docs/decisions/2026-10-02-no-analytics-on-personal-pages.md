# 2026-10-02 · Analytics sends nothing from personal pages

**Decision:**

- **No page view, Web Vital or event leaves a personal page:** `/account`, `/sign-in`, `/admin`, `/connect`, `/credits`, and every path under them.
- One check in `send()` (`apps/web/src/lib/analytics.ts`) covers all three. The list is `apps/web/src/lib/personal.ts`, the same one the proxy uses for the nonce CSP.
- Public pages report their path as before: no query string, no identifiers.

**Why:**

- Audit Nit 4 (2026-10-02): `Analytics.tsx` sent `location.pathname` on every route. Once `ANALYTICS_URL` is set, `/admin/users/<id>` and `/admin/jobs/<id>` would reach the collector with user and job ids. `CLAUDE.md` rule 7 and `09` → Measuring say analytics carry no personal data.
- Skipping these routes is simpler and safer than templating each dynamic segment: a new admin page can't leak an id by forgetting a template.
- Nothing is lost: these pages are one person's, not the product's funnel.
- `09`'s `checkout_started` and `checkout_completed` aren't sent by the web app today. When they are, they need a public page or a server-side count.

**Reverse:** the `reportedPath` check in `send()`.

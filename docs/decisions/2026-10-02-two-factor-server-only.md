# 2026-10-02 · The two-factor endpoints work only on the server

**Decision:**
- **Better Auth's two-factor endpoints answer 404 over HTTP** (problem+json): any `/api/auth/` path with a `two-factor` segment, whatever its case or escapes. A small plugin in `apps/web/src/server/auth.ts` (`twoFactorServerOnly`) answers before Better Auth routes the request. Better Auth's `disabledPaths` would match exact paths only, so an endpoint added in a later version would stay open; the plugin covers them all.
- **Nothing changes for admins.** `/admin/two-factor` already did everything with `auth.api` on the server, which never comes through HTTP: "Set up two-factor" (only while TOTP is off), scan the code, enter a code; then a code or a backup code every 12 hours.
- **The site can't show the secret again, make new backup codes or turn TOTP off.** An admin who loses both the app and the backup codes is reset in the database (delete their `two_factors` row, set `two_factor_enabled` to false), then sets it up again.
- **The first setup is still trust on first use:** until an admin sets up TOTP, their session alone guards the admin. Set it up right after `pnpm admin:promote`.

**Why:** we have no passwords, so the plugin runs with `allowPasswordless: true`, and then its endpoints ask for nothing but a session. Over HTTP, anyone holding an admin's session (a magic link from their mailbox, a stolen cookie) could read the TOTP secret (`get-totp-uri`), mint backup codes or turn TOTP off, and so pass or remove the step-up `docs/07` and `docs/11` ask for. `verify-totp` also had no lockout for a signed-in caller. The app never called these endpoints over HTTP, so closing them there is the smallest safe change. Gating them behind the step-up instead would keep an HTTP surface nothing uses. `src/server/auth.db.test.ts` sets up TOTP the way the admin page does, then tries every two-factor path, in several spellings, with a second session of the same account: each answers 404 and the secret and backup codes stay as they were.

Updates [`../DECISIONS.md`](../DECISIONS.md) → 2026-09-30 · Tool status from the database, and the admin (M3): the plugin holds the secret and the backup codes, and only the server reaches them.

**Reverse:** take `twoFactorServerOnly` out of the plugins in `apps/web/src/server/auth.ts`, and the HTTP checks out of `src/server/auth.db.test.ts`. The endpoints then need a check of their own first, such as a fresh TOTP code.

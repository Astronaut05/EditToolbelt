# 2026-10-02 · Google joins an account only with an email Google verified

**Decision:**
- **No trusted providers for account linking** (`apps/web/src/server/auth.ts`): a Google sign-in joins the existing account with the same email only when Google's token says `email_verified: true`, and the account's own email is verified (Better Auth's default).
- **Otherwise it's refused:** the sign-in comes back to `/sign-in`, which says Google hasn't verified that address and offers an email link. No account is joined and nobody is signed in.
- Linking stays on, and a Google sign-in for an email we don't know still makes a new account, as before.

**Why:** `google` was in `accountLinking.trustedProviders`, and Better Auth links a trusted provider's sign-in even when the provider says the email is unverified. So whoever controls a Google account that carries someone's address unverified (some Google Workspace accounts do) could sign in as that person here. The code comment already promised "the same, verified email"; this makes it true. `src/server/auth.db.test.ts` runs Google's callback with a faked token both ways.

**Reverse:** put `trustedProviders: ['google']` back in `accountLinking` in `apps/web/src/server/auth.ts`, and drop `account_not_linked` from the sign-in page's messages.

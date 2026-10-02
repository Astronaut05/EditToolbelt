/**
 * The welcome grant (docs/05 → Free allowance, Fraud and abuse): 30 credits
 * (config/business.ts), once per verified email, after email verification.
 *
 * - Claimed in `welcome_grant_claims` by HMAC of the normalised email, which
 *   outlives account deletion (docs/04), so deleting and signing up again
 *   doesn't give it twice. The email itself is never stored there.
 * - Normalised before hashing: lowercase, no `+tag`, and Gmail's dots
 *   dropped, so aliases of one inbox share one grant.
 * - Throwaway-inbox domains (config) get no grant; signing in still works.
 * - One account gets it at most once, even after its claim is purged at
 *   12 months: its own ledger already has the row.
 *
 * Runs after each sign-in (src/server/auth.ts); a failure never blocks it.
 */
import { createHmac } from 'node:crypto';

import { disposableEmailDomains, freeAllowance } from '@etb/config/business';
import {
  and,
  applyCredit,
  creditTransactions,
  eq,
  users,
  welcomeGrantClaims,
  type Db,
} from '@etb/db';

export type GrantOutcome =
  | 'granted'
  /** Another account with this email had it. */
  | 'claimed'
  /** This account has it already. */
  | 'already'
  | 'disposable'
  | 'unverified'
  | 'no_user';

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** One inbox, one string: lowercase, no `+tag`, Gmail without dots. */
export function normaliseEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  local = local.split('+')[0] ?? local;
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/** Whether the email's domain, or a domain it's under, is a throwaway inbox. */
export function isDisposable(
  email: string,
  domains: readonly string[] = disposableEmailDomains,
): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  return domains.some((listed) => domain === listed || domain.endsWith(`.${listed}`));
}

/**
 * The HMAC key: WELCOME_GRANT_SECRET, or one derived from BETTER_AUTH_SECRET
 * when it isn't set (docs/DECISIONS.md → "The welcome grant").
 */
export function grantSecret(env: {
  WELCOME_GRANT_SECRET?: string | undefined;
  BETTER_AUTH_SECRET: string;
}): string {
  return (
    env.WELCOME_GRANT_SECRET ??
    createHmac('sha256', env.BETTER_AUTH_SECRET).update('etb.welcome-grant').digest('hex')
  );
}

export function emailHmac(email: string, secret: string): string {
  return createHmac('sha256', secret).update(normaliseEmail(email)).digest('hex');
}

/**
 * Gives the welcome grant to `userId` if it's due, in one transaction: the
 * claim row and the ledger row together, or neither.
 */
export async function claimWelcomeGrant(
  db: Db,
  userId: string,
  options: {
    secret: string;
    credits?: number;
    domains?: readonly string[];
  },
): Promise<GrantOutcome> {
  const credits = options.credits ?? freeAllowance.welcomeGrantCredits;
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        email: users.email,
        verified: users.emailVerified,
        deletedAt: users.deletedAt,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.email || user.deletedAt || user.disabledAt) return 'no_user';
    if (!user.verified) return 'unverified';
    if (isDisposable(user.email, options.domains)) return 'disposable';
    const [had] = await tx
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(
        and(eq(creditTransactions.userId, userId), eq(creditTransactions.kind, 'welcome_grant')),
      )
      .limit(1);
    if (had) return 'already';
    const [claim] = await tx
      .insert(welcomeGrantClaims)
      .values({ emailHmac: emailHmac(user.email, options.secret) })
      .onConflictDoNothing()
      .returning({ emailHmac: welcomeGrantClaims.emailHmac });
    if (!claim) return 'claimed';
    await applyCredit(tx, userId, 'welcome_grant', credits);
    return 'granted';
  });
}

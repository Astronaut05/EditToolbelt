/**
 * Accounts (docs/11 → Auth and accounts, docs/04 → Identity): Better Auth
 * with email magic links and, when configured, Google. No passwords.
 *
 * - Magic links last 15 minutes, work once, and are stored hashed.
 * - Sessions last 30 days, refreshed daily; the cookie is httpOnly, SameSite=Lax,
 *   Secure on https. No IP address or user agent is kept (docs/08).
 * - Google's tokens and avatar are not kept: sign-in is all we use it for.
 * - An admin-disabled account can't sign in. Signing in during the 30-day
 *   grace after deleting an account restores it.
 * - Better Auth's telemetry is off.
 * - TOTP (the two-factor plugin) is for admins: it holds their secret and
 *   backup codes; src/server/admin.ts asks for a code before /admin opens,
 *   since the plugin only steps in on password sign-ins, which we don't have.
 *   Its endpoints work only on the server (auth.api), never over HTTP.
 * - After each sign-in, the welcome grant if it's due (src/server/welcome.ts):
 *   the email is verified by then, by the link or by Google.
 */
import { createHash } from 'node:crypto';

import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { accounts, eq, sessions, twoFactors, users, verifications } from '@etb/db';

import { log } from '../lib/log';
import { db } from './db';
import { serverEnv } from './env';
import { sendMail, signInMail } from './mail';
import { ApiError, problem } from './problem';
import { claimWelcomeGrant, grantSecret } from './welcome';

const DAY = 24 * 60 * 60;

/** Magic links per email address in a window: the endpoint takes no IP, so it's limited per address. */
const LINKS_PER_WINDOW = 3;
const LINK_WINDOW_MS = 15 * 60 * 1000;
const recentLinks = new Map<string, number[]>();

function linkAllowed(email: string, now = Date.now()): boolean {
  // Keyed by a hash: the map never holds an address.
  const key = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const recent = (recentLinks.get(key) ?? []).filter((at) => now - at < LINK_WINDOW_MS);
  if (recent.length >= LINKS_PER_WINDOW) {
    recentLinks.set(key, recent);
    return false;
  }
  recentLinks.set(key, [...recent, now]);
  return true;
}

/** Google's tokens are never needed after sign-in, so none are stored. */
const withoutTokens = <T extends object>(account: T) => ({
  data: {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  },
});

/** Whether a request is for a two-factor endpoint, however its path is spelled. */
function twoFactorPath(url: string): boolean {
  let path = new URL(url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: the path is checked as it came.
  }
  return /\/two-factor(\/|$)/i.test(path);
}

/**
 * The two-factor endpoints answer 404 over HTTP (/api/auth/two-factor/*).
 * With no passwords (`allowPasswordless`) a session alone passes them, so over
 * HTTP it could read the TOTP secret, mint backup codes or turn TOTP off, and
 * skip the admin's step-up. The admin's two-factor page and actions call
 * auth.api on the server instead, which never comes through here.
 */
const twoFactorServerOnly = {
  id: 'etb-two-factor-server-only',
  onRequest: (request) =>
    Promise.resolve(
      twoFactorPath(request.url)
        ? { response: problem(new ApiError(404, 'NOT_FOUND', 'Not found')) }
        : undefined,
    ),
} satisfies BetterAuthPlugin;

function createAuth() {
  const env = serverEnv();
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Email and name only: no avatar URL (docs/08 → minimal data).
            mapProfileToUser: () => ({ image: undefined }),
          },
        }
      : {};
  return betterAuth({
    appName: 'EditToolbelt',
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    user: { fields: { name: 'displayName' } },
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    account: {
      // A Google sign-in joins the account with the same email only when Google
      // says the email is verified. No trusted providers: trusting one would
      // link even an unverified email.
      accountLinking: { enabled: true },
    },
    emailAndPassword: { enabled: false },
    socialProviders: google,
    advanced: {
      database: { generateId: false },
      ipAddress: { disableIpTracking: true },
      cookiePrefix: 'etb',
      useSecureCookies: env.SITE_URL.startsWith('https://'),
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: { before: (user) => Promise.resolve({ data: { ...user, image: null } }) },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db()
              .select({ disabledAt: users.disabledAt, deletedAt: users.deletedAt })
              .from(users)
              .where(eq(users.id, session.userId));
            if (user?.disabledAt) {
              throw new APIError('FORBIDDEN', {
                message: 'This account is disabled.',
                code: 'ACCOUNT_DISABLED',
              });
            }
            if (user?.deletedAt) {
              await db().update(users).set({ deletedAt: null }).where(eq(users.id, session.userId));
            }
            return { data: { ...session, ipAddress: null, userAgent: null } };
          },
          after: async (session) => {
            if (!env.WELCOME_GRANT_ENABLED) return;
            try {
              const outcome = await claimWelcomeGrant(db(), session.userId, {
                secret: grantSecret(env),
              });
              log.info({ user_ref: session.userId, outcome }, 'welcome_grant');
            } catch (error) {
              // Never in the way of signing in; the next sign-in tries again.
              log.warn({ err: error, user_ref: session.userId }, 'welcome_grant.failed');
            }
          },
        },
      },
      account: {
        create: { before: (account) => Promise.resolve(withoutTokens(account)) },
        update: { before: (account) => Promise.resolve(withoutTokens(account)) },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        allowedAttempts: 1,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          const [user] = await db()
            .select({ disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.email, email));
          if (user?.disabledAt) {
            throw new APIError('FORBIDDEN', {
              message: 'This account is disabled.',
              code: 'ACCOUNT_DISABLED',
            });
          }
          if (!linkAllowed(email)) {
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'Too many sign-in links for this address. Try again in 15 minutes.',
              code: 'TOO_MANY_LINKS',
            });
          }
          await sendMail(signInMail(email, url));
        },
      }),
      twoFactor({ issuer: 'EditToolbelt', allowPasswordless: true }),
      twoFactorServerOnly,
      // Last: sets Better Auth's cookies from server actions.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const store = globalThis as typeof globalThis & { etbAuth?: Auth };

export function auth(): Auth {
  store.etbAuth ??= createAuth();
  return store.etbAuth;
}

/** Whether "Continue with Google" is offered: both Google variables are set. */
export function googleEnabled(): boolean {
  const env = serverEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

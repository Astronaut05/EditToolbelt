/**
 * Accounts (docs/11 → Auth and accounts, docs/04 → Identity): Better Auth
 * with email magic links and, when configured, Google. No passwords.
 *
 * - Magic links last 15 minutes, work once, and are stored hashed. Asking for
 *   one is limited per caller, per email address and in all.
 * - Over HTTP only the landings answer (an emailed link, Google's redirect);
 *   everything else is called on the server.
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
import { countCall } from './rate-limit';
import { claimWelcomeGrant, grantSecret } from './welcome';

const DAY = 24 * 60 * 60;

/**
 * Sign-in links are limited three ways, before anything is written or sent:
 * per caller (so one visitor can't mail a list of addresses), per email
 * address (so nobody's inbox is filled), and in all (so no number of callers
 * can spend the mail quota or the domain's reputation). Better Auth's own
 * limiter is off: it counts by IP address, which we don't keep
 * (`disableIpTracking`). Counted in src/server/rate-limit.ts, whose store is
 * bounded.
 */
export const LINK_LIMITS = {
  windowSec: 15 * 60,
  perAddress: 10,
  perEmail: 3,
  allWindowSec: 60 * 60,
  all: 300,
} as const;

export type LinkRefusal = 'TOO_MANY_REQUESTS' | 'TOO_MANY_LINKS' | 'LINKS_PAUSED';

let pauseLoggedAt = -Infinity;

/**
 * A caller this machine itself, or one no proxy named: only off production
 * (the local stack, the end-to-end tests), where every visitor arrives as
 * the loopback address and would share one count. Behind Cloudflare and
 * Railway every request names a real one. The keys are addressOf's: `::1`
 * counts by its /64.
 */
const localCaller = (address: string): boolean =>
  address === 'direct' || address === '0:0:0:0::/64' || /^127\.\d+\.\d+\.\d+$/.test(address);

/**
 * Counts one request for a sign-in link; null when it may go ahead, or why
 * not. `address` is the caller's (src/server/api.ts → addressOf).
 */
export function signInLinkRefused(
  email: string,
  address: string,
  now = Date.now(),
): LinkRefusal | null {
  if (
    !localCaller(address) &&
    countCall(`link:address:${address}`, LINK_LIMITS.perAddress, LINK_LIMITS.windowSec, now)
      .exceeded
  ) {
    return 'TOO_MANY_REQUESTS';
  }
  // Keyed by a hash: the limiter never holds an email address.
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  if (countCall(`link:email:${hash}`, LINK_LIMITS.perEmail, LINK_LIMITS.windowSec, now).exceeded) {
    return 'TOO_MANY_LINKS';
  }
  if (countCall('link:all', LINK_LIMITS.all, LINK_LIMITS.allWindowSec, now).exceeded) {
    // Said once in ten minutes: under a flood every request would say it.
    if (now - pauseLoggedAt > 10 * 60 * 1000) {
      pauseLoggedAt = now;
      log.warn({ limit: LINK_LIMITS.all }, 'auth.links_paused');
    }
    return 'LINKS_PAUSED';
  }
  return null;
}

/**
 * Better Auth's endpoints that answer over HTTP: where an emailed link and
 * Google's redirect land, and its error page. Everything else it offers
 * (asking for a link, changing the profile, listing sessions…) the site
 * calls on the server (`auth().api`), behind its own checks and limits, so
 * over HTTP it answers 404: with the library's limiter off, an open
 * `POST /api/auth/sign-in/magic-link` would mail anyone without limit, and
 * `update-user` would store a name of any size.
 */
const HTTP_AUTH_PATHS = ['/magic-link/verify', '/callback/google', '/error'];

export function authPathAllowed(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const path = pathname.replace(/\/+$/, '');
  return HTTP_AUTH_PATHS.some((allowed) => path === `/api/auth${allowed}`);
}

/** The longest display name kept (src/app/account/actions.ts holds the form to it too). */
export const MAX_DISPLAY_NAME = 80;

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
    logger: {
      // Through our logger, so nothing skips its redaction. Only the message:
      // the arguments are errors that carry a failed query's bound values
      // (email addresses, session tokens), which are never logged (docs/07).
      log: (level, message, ...args: unknown[]) => {
        const first = args[0];
        log[level](
          { source: 'better-auth', ...(first instanceof Error && { err_name: first.name }) },
          // A failed query's message ends in its bound values: cut there.
          message.split(/\n?params:/)[0] ?? '',
        );
      },
    },
    databaseHooks: {
      user: {
        create: { before: (user) => Promise.resolve({ data: { ...user, image: null } }) },
        // Whatever path an update takes: no avatar URL is kept (docs/08), and
        // a display name stays as short as the account form allows.
        update: {
          before: (user) =>
            Promise.resolve({
              data: {
                ...user,
                ...('image' in user && { image: null }),
                ...(typeof user.name === 'string' && {
                  name: user.name.trim().slice(0, MAX_DISPLAY_NAME),
                }),
              },
            }),
        },
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
          // The limits were counted before this request wrote anything
          // (signInLinkRefused, called by the sign-in form's action).
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

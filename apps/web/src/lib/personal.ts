/**
 * Pages for one signed-in person (server build only). Their paths can carry
 * user and job ids (`/admin/users/<id>`), so:
 * - the proxy renders them per request, with a nonce CSP and no caching
 *   (src/proxy.server.ts);
 * - analytics sends nothing from them, not even a page view (src/lib/analytics.ts).
 *
 * A plain module with no imports: the browser bundle reads it too.
 */
export const PERSONAL_ROUTES: readonly string[] = [
  '/account',
  '/sign-in',
  '/admin',
  '/connect',
  '/credits',
];

export function isPersonalPath(pathname: string): boolean {
  return PERSONAL_ROUTES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Third-party APIs a page calls from the browser. The CSP's connect-src names
 * them on every page (apps/web/src/proxy.server.ts, apps/web/scripts/postbuild.ts):
 * a client-side navigation keeps the CSP of the page it started on, so one
 * tool's page alone can't be the only one that allows them
 * (docs/decisions/2026-10-15-subtitles-with-gemini.md).
 * scripts/check-hosts.ts lists their hosts as fixed by their provider.
 */

/** Gemini's API: T09 Subtitle Generator, with the person's own API key. */
export const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';

export const BROWSER_API_ORIGINS: readonly string[] = [GEMINI_API_ORIGIN];

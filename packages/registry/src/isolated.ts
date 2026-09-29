/**
 * Routes that need cross-origin isolation (COOP/COEP), kept as a tiny list so
 * link components can import it without pulling the whole registry into the
 * browser bundle. A test holds it equal to the tools with
 * `crossOriginIsolated: true`.
 *
 * Every link into these routes is a full page load (plain <a>), because a soft
 * navigation keeps the previous document's isolation state (docs/01 →
 * Cross-origin isolation).
 */
export const ISOLATED_PATHS: ReadonlySet<string> = new Set(['/video-converter']);

export function needsFullPageLoad(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? href;
  return ISOLATED_PATHS.has(path.length > 1 ? path.replace(/\/$/, '') : path);
}

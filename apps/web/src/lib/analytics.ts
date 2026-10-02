/**
 * Cookieless, aggregate analytics (docs/09 → Measuring; CLAUDE.md rule 7).
 *
 * Page views and the events below go to a self-hosted, Umami-compatible
 * collector, only when ANALYTICS_URL and ANALYTICS_WEBSITE_ID are set at
 * build time. Nothing is stored in the browser, no identifiers are sent, URLs
 * go without query strings, sizes and durations only as buckets, the
 * referrer only as an origin, and nothing at all when the browser asks not to
 * be tracked (Do Not Track / Global Privacy Control).
 *
 * Nothing is sent from personal pages either (/account, /admin, /connect,
 * /credits, /sign-in: src/lib/personal.ts), not even a page view: their paths
 * can carry user and job ids (`/admin/users/<id>`).
 */
import { isPersonalPath } from './personal';

/** The event list from docs/09, plus real-user Web Vitals (docs/10). */
export interface EventProps {
  tool_file_added: { tool_id: string; mime: string; size: string };
  tool_run_started: { tool_id: string; path: 'client' | 'server' };
  tool_run_succeeded: { tool_id: string; engine_path: string; duration: string };
  tool_run_failed: { tool_id: string; error_code: string; engine_path: string };
  tool_download: { tool_id: string };
  tool_handoff: { from_tool: string; to_tool: string };
  server_fallback_offered: { tool_id: string; reason: string };
  server_fallback_accepted: { tool_id: string; reason: string };
  credits_quote_shown: { tool_id: string; credits: string };
  credits_quote_accepted: { tool_id: string; credits: string };
  checkout_started: { pack_id: string };
  checkout_completed: { pack_id: string };
  signup_completed: { category: string };
  web_vital: { name: string; rating: string; page: string };
}
export type EventName = keyof EventProps;

export const EVENT_NAMES: readonly EventName[] = [
  'tool_file_added',
  'tool_run_started',
  'tool_run_succeeded',
  'tool_run_failed',
  'tool_download',
  'tool_handoff',
  'server_fallback_offered',
  'server_fallback_accepted',
  'credits_quote_shown',
  'credits_quote_accepted',
  'checkout_started',
  'checkout_completed',
  'signup_completed',
  'web_vital',
];

export interface Collector {
  url: string;
  website: string;
}

export function collector(env: { url?: string; website?: string }): Collector | null {
  return env.url && env.website ? { url: env.url.replace(/\/$/, ''), website: env.website } : null;
}

const CONFIG = collector({
  url: process.env.ANALYTICS_URL,
  website: process.env.ANALYTICS_WEBSITE_ID,
});

export interface PageContext {
  hostname: string;
  pathname: string;
  referrer: string;
  language: string;
  screen: string;
}

/** Umami's /api/send body. Pure, so it can be tested. */
export function payload(
  config: Collector,
  page: PageContext,
  event?: { name: string; data: Record<string, string> },
) {
  // Only the origin, and internal navigation isn't a referral.
  let referrer: string;
  try {
    const from = new URL(page.referrer);
    referrer = from.hostname === page.hostname ? '' : from.origin;
  } catch {
    referrer = '';
  }
  return {
    type: 'event' as const,
    payload: {
      website: config.website,
      hostname: page.hostname,
      url: page.pathname,
      referrer,
      language: page.language,
      screen: page.screen,
      ...(event ? { name: event.name, data: event.data } : {}),
    },
  };
}

/** The page as the collector may see it: its path, or null on a personal page (send nothing). */
export function reportedPath(pathname: string): string | null {
  return isPersonalPath(pathname) ? null : pathname;
}

export function optedOut(nav: {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}): boolean {
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function send(event?: { name: string; data: Record<string, string> }): void {
  if (!CONFIG || typeof window === 'undefined') return;
  if (optedOut(navigator)) return;
  const pathname = reportedPath(location.pathname);
  if (pathname === null) return;
  const page: PageContext = {
    hostname: location.hostname,
    pathname,
    referrer: document.referrer,
    language: navigator.language,
    screen: `${String(screen.width)}x${String(screen.height)}`,
  };
  void fetch(`${CONFIG.url}/api/send`, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload(CONFIG, page, event)),
  }).catch(() => undefined);
}

export function trackPageview(): void {
  send();
}

export function track<N extends EventName>(name: N, data: EventProps[N]): void {
  send({ name, data: { ...data } });
}

/** For generic emitters (the ToolShell's onEvent): drops names not in the list. */
export function trackUnknown(name: string, data: Record<string, string>): void {
  if ((EVENT_NAMES as readonly string[]).includes(name)) send({ name, data });
}

export const analyticsEnabled = CONFIG !== null;

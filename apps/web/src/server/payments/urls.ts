/**
 * Our payment URLs, from SITE_URL (no host in code): where the buyer comes
 * back after paying, and where each provider's server calls us. Providers
 * build their return links with `returnUrl`; the admin and the runbook show
 * `webhookUrl` to paste into each provider's dashboard.
 */
import type { ProviderId } from './contract';

/** `/credits/return?purchase=…`: polls the purchase and says what happened. */
export function returnUrl(siteUrl: string, purchaseId: string): string {
  const url = new URL('/credits/return', siteUrl);
  url.searchParams.set('purchase', purchaseId);
  return url.toString();
}

/** `/api/webhooks/<provider>`: Paddle's webhooks, Click's Prepare and Complete, Payme's JSON-RPC. */
export function webhookUrl(siteUrl: string, provider: ProviderId): string {
  return new URL(`/api/webhooks/${provider}`, siteUrl).toString();
}

/** The page that sells credits; a link to it shows only while a provider is on. */
export const BUY_PATH = '/credits/buy';

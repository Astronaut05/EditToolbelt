/**
 * Small helpers the three providers share: env, constant-time comparison,
 * request bodies, amounts. Nothing here logs; errors name env vars, never
 * their values.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { packs, type Pack, type PackId } from '@etb/config/business';

import type { ProviderContext, ProviderId, PurchaseRecord } from '../contract';

/** A provider's env is missing or malformed: a setup problem, never the buyer's. */
export class ProviderConfigError extends Error {
  constructor(provider: ProviderId, problem: string) {
    super(`${provider}: ${problem}`);
    this.name = 'ProviderConfigError';
  }
}

/** The named env vars, all set, or a ProviderConfigError listing the missing names. */
export function readEnv<const K extends string>(
  ctx: ProviderContext,
  provider: ProviderId,
  names: readonly K[],
): Record<K, string> {
  const values = {} as Record<K, string>;
  const missing: string[] = [];
  for (const name of names) {
    const value = ctx.env[name];
    if (value === undefined || value.trim() === '') missing.push(name);
    else values[name] = value.trim();
  }
  if (missing.length > 0) throw new ProviderConfigError(provider, `${missing.join(', ')} not set`);
  return values;
}

/** Constant-time string equality, whatever the lengths (both sides are hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export function packFor(packId: PackId): Pack {
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown pack ${packId}`);
  return pack;
}

/** Throws unless the purchase is this provider's, in its currency, and still pending. */
export function assertCheckoutable(purchase: PurchaseRecord, provider: ProviderId): void {
  const currency = provider === 'paddle' ? 'USD' : 'UZS';
  if (purchase.provider !== provider) throw new Error(`Purchase is not a ${provider} purchase`);
  if (purchase.currency !== currency) throw new Error(`A ${provider} purchase is in ${currency}`);
  if (purchase.status !== 'pending') throw new Error('Only a pending purchase can be paid');
  if (!Number.isSafeInteger(purchase.amountMinor) || purchase.amountMinor <= 0)
    throw new Error('The purchase has no amount');
}

/** Tiyin → sums with 2 decimals, as Click shows and sends them: 6300000 → "63000.00". */
export function sums(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const part = amountMinor % 100;
  return `${String(whole)}.${String(part).padStart(2, '0')}`;
}

/**
 * Sums as text → tiyin, exactly: "63000", "63000.0" and "63000.00" are all
 * 6300000. Null for anything else, including fractions of a tiyin.
 */
export function parseSums(text: string): number | null {
  const match = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (/[^0]/.test(fraction.slice(2))) return null;
  const tiyin = Number(match[1]) * 100 + Number(fraction.slice(0, 2));
  return Number.isSafeInteger(tiyin) ? tiyin : null;
}

/**
 * Credits a refund of `refundedMinor` out of `paidMinor` takes back from a
 * purchase of `credits` (docs/05 → Refunds: the unused portion): in
 * proportion, rounded, at least 1. Undefined for the whole payment or more:
 * then the store takes all that's left. The store never takes more than is
 * left either way.
 */
export function creditsForRefund(
  credits: number,
  refundedMinor: number,
  paidMinor: number,
): number | undefined {
  if (!(refundedMinor > 0) || !(paidMinor > 0)) throw new Error('Cannot size a refund');
  if (refundedMinor >= paidMinor) return undefined;
  return Math.min(credits, Math.max(1, Math.round((credits * refundedMinor) / paidMinor)));
}

/** The buyer comes back here after paying (Click, Payme). */
export function returnUrl(ctx: ProviderContext, purchaseId: string): string {
  const origin = ctx.siteUrl.replace(/\/+$/, '');
  return `${origin}/credits/return?purchase=${encodeURIComponent(purchaseId)}`;
}

/** Webhook bodies are small; anything bigger than this is refused unread. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The raw body, or null when it is larger than the limit. A declared
 * Content-Length over the limit is refused unread; any other body (chunked,
 * or lying about its length) is read chunk by chunk and dropped as soon as
 * the running total passes the limit, so it is never buffered whole.
 */
export async function readBody(request: Request, limit = MAX_BODY_BYTES): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** A short, value-free description of a thrown error, for webhook_events.error. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return 'Unknown error';
}

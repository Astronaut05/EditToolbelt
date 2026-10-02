/**
 * Pack prices in each provider's currency, and money as people read it
 * (docs/05 → Packs). Amounts are integers in minor units: cents for USD,
 * tiyin for UZS (1 sum = 100 tiyin), as `purchases.amount_minor` stores them.
 * Pure: the buy page, the account page and the admin share it.
 */
import { packs, type Pack, type PackId } from '@etb/config/business';

import type { Currency } from '../server/payments/contract';

export type { Currency };

/** What `pack` costs in `currency`, in minor units (config/business.ts). */
export function packAmountMinor(pack: Pack, currency: Currency): number {
  return currency === 'USD' ? Math.round(pack.priceUsd * 100) : Math.round(pack.priceUzs * 100);
}

export function packById(id: string): Pack | undefined {
  return packs.find((pack) => pack.id === id);
}

export const PACK_NAMES: Record<PackId, string> = {
  starter: 'Starter',
  creator: 'Creator',
  studio: 'Studio',
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const sums = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** "$15.00", "189,000 UZS". */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  if (currency === 'USD') return usd.format(major);
  return `${sums.format(major)} ${currency}`;
}

/** "2.1¢ a credit", "270 UZS a credit": a pack's price per credit, for comparing packs. */
export function perCredit(pack: Pack, currency: Currency): string {
  const minor = packAmountMinor(pack, currency) / pack.credits;
  return currency === 'USD'
    ? `${(Math.round(minor * 100) / 100).toString()}¢ a credit`
    : `${sums.format(Math.round(minor / 100))} UZS a credit`;
}

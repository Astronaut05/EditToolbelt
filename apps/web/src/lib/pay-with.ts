/**
 * How /credits/buy offers the providers (docs/DECISIONS.md → "Payments: three
 * providers…"): visitors from Uzbekistan (Cloudflare's `cf-ipcountry`) see
 * Click and Payme first, priced in sum; everyone else sees Paddle first, in
 * dollars. Anyone can pick another. Only providers that are on are offered.
 */
import type { Currency, ProviderId } from '../server/payments/contract';

export interface PayWith {
  id: ProviderId;
  name: string;
  currency: Currency;
  /** What it takes and how it prices, in a line. */
  methods: string;
}

const INFO: Record<ProviderId, Omit<PayWith, 'id'>> = {
  paddle: {
    name: 'Paddle',
    currency: 'USD',
    methods:
      'Cards, PayPal, Apple Pay and Google Pay. Prices in US dollars with tax included; Paddle may show them in your currency.',
  },
  click: {
    name: 'Click',
    currency: 'UZS',
    methods: 'Uzcard and Humo cards, through Click. Prices in Uzbek sum.',
  },
  payme: {
    name: 'Payme',
    currency: 'UZS',
    methods: 'Uzcard and Humo cards, through Payme. Prices in Uzbek sum.',
  },
};

const LOCAL_FIRST: readonly ProviderId[] = ['click', 'payme', 'paddle'];
const WORLD_FIRST: readonly ProviderId[] = ['paddle', 'click', 'payme'];

/** The enabled providers in the order this visitor sees them. */
export function payWithOrder(country: string | null, enabled: readonly ProviderId[]): PayWith[] {
  const order = country?.trim().toUpperCase() === 'UZ' ? LOCAL_FIRST : WORLD_FIRST;
  return order.filter((id) => enabled.includes(id)).map((id) => ({ id, ...INFO[id] }));
}

/** A provider's name from a stored id. */
export function providerName(id: string): string {
  return (INFO as Partial<Record<string, { name: string }>>)[id]?.name ?? id;
}

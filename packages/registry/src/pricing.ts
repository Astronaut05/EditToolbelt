/**
 * A server job's price in credits from its tool's rule and the probed input
 * (docs/05 → Pricing a job). Computed on the server from the probe, never
 * from numbers a client sends.
 */
import type { CreditRule } from './schema';

export interface PriceInput {
  /** From the probe. */
  durationMs?: number | null;
  /** Output megapixels where the tool knows them, else the input's. */
  megapixels?: number | null;
}

export function priceOf(rule: CreditRule, input: PriceInput): number {
  switch (rule.kind) {
    case 'free':
      return 0;
    case 'flat':
      return rule.credits;
    case 'perMinute': {
      const minutes = Math.max(0, input.durationMs ?? 0) / 60_000;
      return Math.max(rule.minCredits, Math.ceil(minutes * rule.credits - 1e-9));
    }
    case 'perMegapixel': {
      const megapixels = Math.max(0, input.megapixels ?? 0);
      return Math.max(rule.minCredits, Math.ceil(megapixels * rule.credits - 1e-9));
    }
  }
}

/** The rule in words, for the server offer: "1 credit a minute, at least 2". */
export function priceLabel(rule: CreditRule): string {
  const credits = (n: number) => `${String(n)} credit${n === 1 ? '' : 's'}`;
  switch (rule.kind) {
    case 'free':
      return 'Free';
    case 'flat':
      return credits(rule.credits);
    case 'perMinute':
      return `${credits(rule.credits)} a minute, at least ${String(rule.minCredits)}`;
    case 'perMegapixel':
      return `${credits(rule.credits)} a megapixel, at least ${String(rule.minCredits)}`;
  }
}

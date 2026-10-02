/**
 * Business numbers (docs/01-architecture.md → Configuration, docs/05-credits-and-payments.md).
 *
 * Everything numeric-and-commercial lives here, never in components. All values
 * are STARTING PLACEHOLDERS: revisit after two weeks of real job data. Tool-level
 * numbers can also be overridden at runtime by admin through `tool_flags` (M3+).
 */

const MiB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Credit packs (docs/05 → Packs). Prices are USD, tax-inclusive; Paddle
// localises the display currency. Smallest pack is $5 (decided 2026-09-29).
// ---------------------------------------------------------------------------

export type PackId = 'starter' | 'creator' | 'studio';

export interface Pack {
  id: PackId;
  credits: number;
  /** Paddle, everywhere but Uzbekistan. Tax-inclusive; Paddle shows it in local currency. */
  priceUsd: number;
  /**
   * Click and Payme, for Uzbek cards (Uzcard, Humo). Whole sums. Set near the
   * USD price at about 12,700 UZS per dollar, rounded; their fees are lower
   * than Paddle's, so the same pack nets more. Review with the exchange rate.
   */
  priceUzs: number;
}

export const packs: readonly Pack[] = [
  { id: 'starter', credits: 200, priceUsd: 5, priceUzs: 63_000 },
  { id: 'creator', credits: 700, priceUsd: 15, priceUzs: 189_000 },
  { id: 'studio', credits: 2000, priceUsd: 40, priceUzs: 499_000 },
];

export const MIN_PACK_PRICE_USD = 5;

// ---------------------------------------------------------------------------
// Pricing formula inputs (docs/05 → Pricing a job).
// ---------------------------------------------------------------------------

export const pricing = {
  /** credits = ceil(expected_cost_usd × margin / creditNetUsd) */
  margin: 3,
  /** Alert when a tool's real margin stays under this for a week. */
  marginAlertBelow: 2,
  /** Planning figure. Prices are tax-inclusive. */
  typicalVat: 0.2,
  /** Paddle: 5% + $0.50 per transaction. TODO(M5): confirm in the Paddle dashboard which amount the 5% is taken from. */
  paddleFeeRate: 0.05,
  paddleFeeFixedUsd: 0.5,
} as const;

/** What one credit of `pack` really brings in, after VAT and Paddle's fee. */
export function packNetUsdPerCredit(pack: Pack): number {
  const netOfVat = pack.priceUsd / (1 + pricing.typicalVat);
  const fee = pricing.paddleFeeRate * pack.priceUsd + pricing.paddleFeeFixedUsd;
  return (netOfVat - fee) / pack.credits;
}

/**
 * `credit_net_usd`: net USD per credit on the pack that is worst for us.
 * Computed, never hand-typed (≈ $0.0154 with the placeholder packs).
 */
export const creditNetUsd: number = Math.min(...packs.map(packNetUsdPerCredit));

// ---------------------------------------------------------------------------
// Free allowance and abuse limits (docs/05 → Free allowance, Fraud and abuse).
// Anonymous visitors get browser tools only; server jobs require sign-in.
// ---------------------------------------------------------------------------

export const freeAllowance = {
  /** One-time grant after email verification; one per email (welcome_grant_claims). */
  welcomeGrantCredits: 30,
  /** Small server jobs per day for signed-in users who never paid. */
  signedInDailyServerJobs: 3,
} as const;

export const maxConcurrentServerJobs = {
  free: 2,
  paid: 4,
} as const;

/**
 * Throwaway-inbox domains refused for the welcome grant (docs/05 → Fraud and
 * abuse). A subdomain of one counts too. Sign-in still works; only the grant
 * is refused. Add domains as they show up in Admin → Users.
 */
export const disposableEmailDomains: readonly string[] = [
  '10minutemail.com',
  '20minutemail.com',
  'anonbox.net',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'mail.tm',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'moakt.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.dev',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'tmail.ws',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];

// ---------------------------------------------------------------------------
// Retention (docs/01 → Retention, CLAUDE.md rule 4). The sweeper is the
// guarantee; bucket lifecycle rules are only the backstop.
// ---------------------------------------------------------------------------

export const retention = {
  /** Server outputs are deleted this long after the job finishes. */
  outputMinutes: 60,
  sweeperIntervalMinutes: 5,
  /** Uploads never attached to a job, and open multipart uploads, are removed after this. */
  unconsumedUploadMinutes: 60,
  /** R2 lifecycle backstop: Expiration and AbortIncompleteMultipartUpload, in whole days. */
  lifecycleBackstopDays: 1,
  /** Job rows are aggregated into tool_stats_daily and deleted after this. */
  jobRowDays: 90,
  /** Account deletion grace period before the user row is scrubbed. */
  accountDeletionGraceDays: 30,
  /** welcome_grant_claims rows are purged after this. */
  welcomeGrantClaimMonths: 12,
} as const;

// ---------------------------------------------------------------------------
// Queue and uploads (docs/01 → Upload, Queue; docs/11 → Storage).
// ---------------------------------------------------------------------------

export const queue = {
  /** Queued longer than this → expired, credits released, user told to retry. */
  expireQueuedAfterMinutes: 15,
} as const;

export const uploads = {
  /** R2 needs equal-size parts (min 5 MiB) except the last. Larger parts for multi-GB files. */
  partSizeBytes: 8 * MiB,
  parallelParts: 4,
  uploadUrlTtlMinutes: 15,
  downloadUrlTtlMinutes: 10,
} as const;

// ---------------------------------------------------------------------------
// Global file safety caps (docs/11 → File intake). Per-tool limits live in the
// registry and must stay within these.
// ---------------------------------------------------------------------------

export const fileSafety = {
  /** Decompression-bomb guard for any decoded image or frame. */
  maxDecodedPixels: 100_000_000,
} as const;

// ---------------------------------------------------------------------------
// Paddle price ids per pack and environment (docs/05 → Payments). Created in
// the Paddle dashboard in M5; empty until then.
// ---------------------------------------------------------------------------

export const paddlePriceIds: Record<'sandbox' | 'live', Record<PackId, string>> = {
  sandbox: { starter: '', creator: '', studio: '' },
  live: { starter: '', creator: '', studio: '' },
};

// ---------------------------------------------------------------------------
// Uzbek fiscal receipts (Click and Payme send the receipt to the tax service's
// OFD). Each line needs the product's MXIK (IKPU) code and package code from
// the tax catalogue; Click's lines also name the seller by TIN or PINFL. Empty
// until Astro has them (docs/runbooks/turn-on-payments.md); a provider that
// needs them refuses to switch on while they're empty. None of these is a
// secret: they're printed on every receipt.
// ---------------------------------------------------------------------------

export interface FiscalReceiptConfig {
  /** MXIK / IKPU code of "credits for online services", from tasnif.soliq.uz. */
  readonly mxik: string;
  /** Package code (o'lchov birligi) for one pack, from the same catalogue. */
  readonly packageCode: string;
  /** VAT in percent, a whole number: 0 while the seller isn't a VAT payer. */
  readonly vatPercent: number;
  /** The seller's TIN (INN, 9 digits): a company. Set this or `pinfl`, not both. */
  readonly tin: string;
  /** The seller's PINFL (14 digits): a sole trader or self-employed person. */
  readonly pinfl: string;
}

export const fiscalReceipt: FiscalReceiptConfig = {
  mxik: '',
  packageCode: '',
  vatPercent: 0,
  tin: '',
  pinfl: '',
};

/** How Click's receipt lines name the seller (its `CommissionInfo`). */
export type SellerTaxId = { TIN: string } | { PINFL: string };

/**
 * The seller's TIN or PINFL from `fiscal`, or what's wrong with them: both
 * empty, both set, or not 9 (TIN) or 14 (PINFL) digits.
 */
export function sellerTaxId(
  fiscal: Pick<FiscalReceiptConfig, 'tin' | 'pinfl'>,
): { ok: true; id: SellerTaxId } | { ok: false; problem: string } {
  const tin = fiscal.tin.trim();
  const pinfl = fiscal.pinfl.trim();
  if (tin && pinfl)
    return { ok: false, problem: 'Set fiscalReceipt.tin or fiscalReceipt.pinfl, not both.' };
  if (tin) {
    return /^\d{9}$/.test(tin)
      ? { ok: true, id: { TIN: tin } }
      : { ok: false, problem: 'fiscalReceipt.tin must be 9 digits.' };
  }
  if (pinfl) {
    return /^\d{14}$/.test(pinfl)
      ? { ok: true, id: { PINFL: pinfl } }
      : { ok: false, problem: 'fiscalReceipt.pinfl must be 14 digits.' };
  }
  return { ok: false, problem: 'fiscalReceipt.tin or fiscalReceipt.pinfl is empty.' };
}

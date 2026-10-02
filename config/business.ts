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
  priceUsd: number;
}

export const packs: readonly Pack[] = [
  { id: 'starter', credits: 200, priceUsd: 5 },
  { id: 'creator', credits: 700, priceUsd: 15 },
  { id: 'studio', credits: 2000, priceUsd: 40 },
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
// GPU costs (docs/05 → GPU costs and the daily budget). Modal bills each GPU
// function's container by the second: its GPU, plus the CPU cores and memory
// it asks for (apps/worker/src/etb_worker/gpu/modal_app.py: every tool
// function asks for 2 cores and 8 GiB). PLACEHOLDERS taken on 2026-10-02 from
// Modal's published per-second prices; confirm them in Modal's dashboard.
// ---------------------------------------------------------------------------

export type GpuType = 'T4' | 'L4';

export const gpuPricing = {
  /** When these prices were read; Admin shows it beside the costs. */
  checkedOn: '2026-10-02',
  /** USD per GPU-second. */
  gpuUsdPerSecond: { T4: 0.000164, L4: 0.000222 } satisfies Record<GpuType, number>,
  /** USD per CPU core-second and per GiB-second. */
  cpuCoreUsdPerSecond: 0.0000131,
  memoryGibUsdPerSecond: 0.00000222,
  /** What every tool function asks Modal for (modal_app.py: CPU_CORES, MEMORY_MIB). */
  functionCpuCores: 2,
  functionMemoryGib: 8,
} as const;

/**
 * USD a second of one GPU function's container: its GPU, CPU and memory. The
 * jobs API writes it on each GPU job (`jobs.gpu_rate_usd`); the worker prices
 * the job's GPU time with it and stops at the daily budget.
 */
export function gpuRateUsd(gpu: GpuType): number {
  return (
    gpuPricing.gpuUsdPerSecond[gpu] +
    gpuPricing.functionCpuCores * gpuPricing.cpuCoreUsdPerSecond +
    gpuPricing.functionMemoryGib * gpuPricing.memoryGibUsdPerSecond
  );
}

export const gpuBudget = {
  /** The daily GPU budget until an admin sets another (the `gpu_budget` row's default). */
  defaultDailyUsd: 1,
  /** Alerts go out at these shares of today's spend. */
  alertAt: [0.8, 1],
  /**
   * The longest idle window of any GPU function, in seconds. A GPU job may
   * start only while today's spend, with every running GPU job counted at its
   * worst case (its time limit plus this, at its rate), is under the budget.
   * The worker's MAX_IDLE_TAIL_SEC (apps/worker/src/etb_worker/gpu); a test
   * holds them together.
   */
  worstCaseIdleSec: 30,
} as const;

// ---------------------------------------------------------------------------
// Free allowance and abuse limits (docs/05 → Free allowance, Fraud and abuse).
// Anonymous visitors get browser tools only; server jobs require sign-in.
// ---------------------------------------------------------------------------

export const freeAllowance = {
  /** One-time grant after email verification; one per email (welcome_grant_claims). */
  welcomeGrantCredits: 30,
  /** Small server jobs per day for signed-in users who never paid. */
  signedInDailyServerJobs: 3,
  /**
   * Free previews a day (A10's 10 s snippet) for accounts that have paid. A
   * never-paid account spends one of its daily jobs on each instead (docs/05).
   */
  paidDailyPreviews: 10,
} as const;

export const maxConcurrentServerJobs = {
  free: 2,
  paid: 4,
} as const;

/** Domains refused for the welcome grant. Filled in before M5. */
export const disposableEmailDomains: readonly string[] = [];

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

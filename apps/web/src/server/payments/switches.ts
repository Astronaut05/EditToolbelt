/**
 * Whether a provider takes money (docs/05 → Payments; docs/DECISIONS.md →
 * "Payments: three providers behind one interface, built and switched off").
 * Three locks, all needed:
 *
 * 1. `PAYMENTS_ENABLED=true`, the global kill switch (env, default off);
 * 2. the admin's switch for that provider (`payment_settings`, default off);
 * 3. the provider is in this build and every one of its `requiredEnv` is set;
 *    Click and Payme also need the fiscal receipt codes in config/business.ts.
 *
 * The admin switch refuses to turn on while 3 isn't met, and every change
 * goes into the audit log with its reason. Read on every request (three rows,
 * no cache), so switching off takes effect at once.
 */
import { fiscalReceipt } from '@etb/config/business';
import { paymentSettings, type Db, type Queryable } from '@etb/db';

import { audit } from '../audit';
import { serverEnv } from '../env';
import { PROVIDER_IDS, type PaymentProvider, type ProviderId } from './contract';
import { providers as built } from './providers';
import { stubProvider } from './stub';

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  paddle: 'Paddle',
  click: 'Click',
  payme: 'Payme',
};

/** Providers that send a fiscal receipt to Uzbekistan's tax service (OFD) with every sale. */
export const FISCAL_PROVIDERS: readonly ProviderId[] = ['click', 'payme'];

/** The fields of config/business.ts → fiscalReceipt a sale can't do without. */
export interface FiscalReceipt {
  mxik: string;
  packageCode: string;
}

/** What the switches read: the kill switch, the env (keys) and the providers in this build. */
export interface PaymentEnv {
  enabled: boolean;
  vars: Readonly<Record<string, string | undefined>>;
  providers: readonly PaymentProvider[];
  fiscal: FiscalReceipt;
}

/** The built providers, with the test stub standing in for one (PAYMENTS_STUB, APP_ENV=test only). */
export function availableProviders(
  list: readonly PaymentProvider[],
  stub: ProviderId | undefined,
): PaymentProvider[] {
  const byId = new Map(list.map((provider) => [provider.id, provider]));
  if (stub) byId.set(stub, stubProvider(stub));
  return PROVIDER_IDS.flatMap((id) => byId.get(id) ?? []);
}

/** The running server's payment env. */
export function paymentEnv(): PaymentEnv {
  const env = serverEnv();
  return {
    enabled: env.PAYMENTS_ENABLED,
    vars: process.env,
    providers: availableProviders(built, env.APP_ENV === 'test' ? env.PAYMENTS_STUB : undefined),
    fiscal: fiscalReceipt,
  };
}

export interface ProviderSetting {
  enabled: boolean;
  updatedAt: Date;
  updatedBy: string | null;
  reason: string | null;
}

export interface ProviderState {
  id: ProviderId;
  name: string;
  /** Its code is in this release. */
  built: boolean;
  /** Each variable it needs (names only, never values) and whether it's set. */
  keys: { name: string; set: boolean }[];
  /** Click and Payme: the fiscal receipt fields in config/business.ts. Empty for Paddle. */
  fiscal: { name: string; set: boolean }[];
  /** The admin's switch, and who set it last. */
  setting: ProviderSetting | null;
  switchedOn: boolean;
  /** Why the admin switch can't turn on now; empty when it can. */
  blockers: string[];
  /** It takes money now: all three locks open. */
  on: boolean;
  provider: PaymentProvider | null;
}

const isSet = (value: string | undefined) => Boolean(value?.trim());

/** The state of one provider from what the switches read. Pure. */
export function providerState(
  id: ProviderId,
  env: PaymentEnv,
  setting: ProviderSetting | null,
): ProviderState {
  const provider = env.providers.find((candidate) => candidate.id === id) ?? null;
  const keys = (provider?.requiredEnv ?? []).map((name) => ({ name, set: isSet(env.vars[name]) }));
  const fiscal = FISCAL_PROVIDERS.includes(id)
    ? (['mxik', 'packageCode'] as const).map((field) => ({
        name: `fiscalReceipt.${field}`,
        set: isSet(env.fiscal[field]),
      }))
    : [];
  const blockers = [
    ...(provider ? [] : [`This release has no ${PROVIDER_NAMES[id]} integration.`]),
    ...keys
      .filter((key) => !key.set)
      .map((key) => `${key.name} is not set (a Railway shared variable on the web service).`),
    ...fiscal
      .filter((field) => !field.set)
      .map((field) => `${field.name} is empty in config/business.ts.`),
  ];
  const switchedOn = setting?.enabled ?? false;
  return {
    id,
    name: PROVIDER_NAMES[id],
    built: provider !== null,
    keys,
    fiscal,
    setting,
    switchedOn,
    blockers,
    on: env.enabled && switchedOn && blockers.length === 0,
    provider,
  };
}

async function loadSettings(db: Queryable): Promise<Map<string, ProviderSetting>> {
  const rows = await db.select().from(paymentSettings);
  return new Map(
    rows.map((row) => [
      row.provider,
      {
        enabled: row.enabled,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        reason: row.reason,
      },
    ]),
  );
}

/** Every provider's state, in a fixed order (Paddle, Click, Payme). */
export async function paymentStates(
  db: Queryable,
  env: PaymentEnv = paymentEnv(),
): Promise<ProviderState[]> {
  const settings = await loadSettings(db);
  return PROVIDER_IDS.map((id) => providerState(id, env, settings.get(id) ?? null));
}

/** The providers taking money now; empty while payments are off. */
export async function enabledProviders(
  db: Queryable,
  env: PaymentEnv = paymentEnv(),
): Promise<PaymentProvider[]> {
  if (!env.enabled) return [];
  return (await paymentStates(db, env)).flatMap((state) =>
    state.on && state.provider ? [state.provider] : [],
  );
}

/** The provider `id` if it takes money now, else null (its webhook path then answers 404). */
export async function enabledProvider(
  db: Queryable,
  id: string,
  env: PaymentEnv = paymentEnv(),
): Promise<PaymentProvider | null> {
  if (!env.enabled || !(PROVIDER_IDS as readonly string[]).includes(id)) return null;
  return (await enabledProviders(db, env)).find((provider) => provider.id === id) ?? null;
}

/** Whether anything sells credits now: the "Buy credits" links show only then. */
export async function canBuyCredits(
  db: Queryable,
  env: PaymentEnv = paymentEnv(),
): Promise<boolean> {
  return (await enabledProviders(db, env)).length > 0;
}

export type SwitchResult = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * The admin turns a provider on or off, with a reason, into the audit log.
 * Turning on is refused while its keys, its fiscal fields or its code are
 * missing; turning off always works.
 */
export async function setProviderSwitch(
  db: Db,
  change: { adminId: string; provider: ProviderId; enabled: boolean; reason: string },
  env: PaymentEnv = paymentEnv(),
): Promise<SwitchResult> {
  const reason = change.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    return { ok: false, reason: 'Give a reason of 3 to 500 characters.' };
  }
  return db.transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const state = providerState(change.provider, env, settings.get(change.provider) ?? null);
    if (change.enabled && state.blockers.length > 0) {
      return {
        ok: false,
        reason: `${state.name} can’t be switched on yet. ${state.blockers.join(' ')}`,
      };
    }
    const next = {
      enabled: change.enabled,
      updatedAt: new Date(),
      updatedBy: change.adminId,
      reason,
    };
    await tx
      .insert(paymentSettings)
      .values({ provider: change.provider, ...next })
      .onConflictDoUpdate({ target: paymentSettings.provider, set: next });
    await audit(tx, {
      adminId: change.adminId,
      action: change.enabled ? 'payments.provider_on' : 'payments.provider_off',
      targetType: 'payment_provider',
      targetId: change.provider,
      before: { enabled: state.switchedOn },
      after: { enabled: change.enabled, payments_enabled: env.enabled },
      reason,
    });
    return { ok: true, changed: state.switchedOn !== change.enabled };
  });
}

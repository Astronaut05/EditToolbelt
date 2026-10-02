/**
 * A ProviderContext for tests and simulators: a store, fixed env, a clock
 * you move by hand, and no network unless a fake fetch is given.
 */
import type { ProviderContext, PurchaseStore } from '../../contract';

/** A hand-moved clock: `now` is what providers see as ctx.now(). */
export class Clock {
  constructor(private ms: number = Date.UTC(2026, 9, 2, 9, 0, 0)) {}

  readonly now = (): Date => new Date(this.ms);

  advance(ms: number): void {
    this.ms += ms;
  }

  set(date: Date): void {
    this.ms = date.getTime();
  }
}

export const TEST_SITE_URL = 'https://etb.test';

export function testContext(options: {
  store: PurchaseStore;
  env: Record<string, string | undefined>;
  clock?: Clock;
  fetch?: ProviderContext['fetch'];
  siteUrl?: string;
}): ProviderContext {
  const clock = options.clock ?? new Clock();
  return {
    store: options.store,
    siteUrl: options.siteUrl ?? TEST_SITE_URL,
    env: options.env,
    now: clock.now,
    fetch:
      options.fetch ??
      (() => Promise.reject(new Error('No network in this test: pass a fake fetch'))),
  };
}

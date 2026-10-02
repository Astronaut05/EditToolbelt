export async function register(): Promise<void> {
  // Node only: Next also compiles this file for the edge runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { log } = await import('./lib/log');
    log.info('web.started');
    // The server build sends Click's fiscal receipts until Click accepts them
    // (server/payments/fiscal-sender.ts); never while `next build` runs.
    if (
      process.env.ETB_TARGET === 'server' &&
      process.env.NEXT_PHASE !== 'phase-production-build'
    ) {
      const { startFiscalSender } = await import('./server/payments/fiscal-sender');
      startFiscalSender();
    }
  }
}

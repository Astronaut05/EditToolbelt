export async function register(): Promise<void> {
  // Node only: Next also compiles this file for the edge runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { log } = await import('./lib/log');
    log.info('web.started');
    if (process.env.ETB_TARGET === 'server') {
      // What stands in front of the site, said once: a half-set Access pair
      // doesn't stop the start, so this line is where it shows.
      const { accessConfig, originSecret, siteAccess } = await import('./server/access');
      const set = (name: string) => Boolean(process.env[name]?.trim());
      const access = accessConfig(process.env) !== null;
      const event = {
        site_access: siteAccess(process.env),
        access_checked: access,
        origin_locked: originSecret(process.env) !== null,
      };
      if (!access && (set('CF_ACCESS_TEAM_DOMAIN') || set('CF_ACCESS_AUD'))) {
        log.warn(event, 'access.misconfigured');
      } else {
        log.info(event, 'access.mode');
      }
    }
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

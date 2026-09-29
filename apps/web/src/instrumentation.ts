export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { log } = await import('./lib/log');
  log.info('web.started');
}

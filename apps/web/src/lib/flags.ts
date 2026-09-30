/**
 * Before rendering anything that shows tool status: bring the registry's
 * overrides up to date. The server build reads them from the database
 * (src/server/flags.ts); the static export has none, and this is a no-op.
 */
export async function loadToolFlags(): Promise<void> {
  if (process.env.ETB_TARGET !== 'server') return;
  const { refreshToolFlags } = await import('../server/flags');
  await refreshToolFlags();
}

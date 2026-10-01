/**
 * The admin switches the server specs rely on, set once before any test talks
 * to the server: Compress Video's server path, and the server-only tools'
 * status. The server's flag caches (the pages' and the API's, 30 s each) then
 * never hold an older state, whichever spec or browser runs first. The specs
 * also set what they need, so each runs on its own.
 */
import { toolFlags } from '@etb/db';

import { closeTestDb, testDb } from './helpers';

export default async function globalSetup() {
  const db = testDb();
  await db
    .insert(toolFlags)
    .values({ toolId: 'compress-video', serverEnabled: true })
    .onConflictDoUpdate({ target: toolFlags.toolId, set: { serverEnabled: true } });
  for (const toolId of ['vfr-to-cfr', 'burn-subtitles']) {
    await db
      .insert(toolFlags)
      .values({ toolId, status: 'beta' })
      .onConflictDoUpdate({ target: toolFlags.toolId, set: { status: 'beta' } });
  }
  await closeTestDb();
}

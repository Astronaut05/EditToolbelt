import { conversions, tools } from '@etb/registry';
import { buildSearchIndex } from '@etb/registry/search';

import { loadToolFlags } from '../../lib/flags';

// The search box's index (route.static.ts in the static build), with the tool
// status in the database: built per request from the 30 s flag cache, and
// kept 30 s by browsers. Not Next's ISR, whose header (s-maxage plus a year of
// stale-while-revalidate) lets a browser answer from its stale copy and fetch
// the new one behind it, so an admin's change showed a visit late.
export const dynamic = 'force-dynamic';

export async function GET() {
  await loadToolFlags();
  return Response.json(buildSearchIndex(tools, conversions), {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
}

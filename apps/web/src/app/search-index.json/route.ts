import { conversions, tools } from '@etb/registry';
import { buildSearchIndex } from '@etb/registry/search';

import { loadToolFlags } from '../../lib/flags';

// Written at build time: /search-index.json, loaded by the search box on first
// use so the index never sits in the initial JS. The server build re-renders it
// with the tool status in the database.
export const dynamic = 'force-static';
export const revalidate = 30;

export async function GET() {
  await loadToolFlags();
  return Response.json(buildSearchIndex(tools, conversions));
}

import { conversions, tools } from '@etb/registry';
import { buildSearchIndex } from '@etb/registry/search';

// Written at build time: /search-index.json, loaded by the search box on first
// use so the index never sits in the initial JS. The server build has its own
// (route.server.ts), with the tool status in the database.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildSearchIndex(tools, conversions));
}

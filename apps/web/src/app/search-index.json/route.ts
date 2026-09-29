import { conversions, tools } from '@etb/registry';
import { buildSearchIndex } from '@etb/registry/search';

// Written once at build time: /search-index.json, loaded by the search box on
// first use so the index never sits in the initial JS.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildSearchIndex(tools, conversions));
}

/**
 * GET /api/v1/tools (docs/06): the registry as clients see it, with the
 * admin's overrides applied (at most 30 s old). Anonymous; `?surface=panel`
 * filters.
 */
import type { ToolList } from '@etb/core/api';
import { isListed, surfacesOf, tools } from '@etb/registry';
import { SURFACES, type Surface } from '@etb/registry/schema';

import { loadToolFlags } from '../../../../lib/flags';
import { ApiError, preflight, route } from '../../../../server/api';
import { toolView } from '../../../../server/tools';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const isSurface = (value: string): value is Surface =>
  (SURFACES as readonly string[]).includes(value);

export const GET = route('tools', async (request) => {
  await loadToolFlags();
  const surface = new URL(request.url).searchParams.get('surface');
  if (surface !== null && !isSurface(surface)) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'Unknown surface',
      `surface is one of: ${SURFACES.join(', ')}`,
    );
  }
  const list: ToolList = {
    tools: tools
      .filter(isListed)
      .filter((tool) => surface === null || surfacesOf(tool).includes(surface))
      .map(toolView),
  };
  return Response.json(list, { headers: { 'Cache-Control': 'public, max-age=30' } });
});

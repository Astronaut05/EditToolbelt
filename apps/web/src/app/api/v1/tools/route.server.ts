/**
 * GET /api/v1/tools (docs/06): the registry as clients see it, with the
 * admin's overrides applied (at most 30 s old). Anonymous; `?surface=panel`
 * filters. One tool with its option schema (`/tools/:id`) comes with M6.
 */
import { costOf, isListed, limitsOf, statusOf, surfacesOf, toolFlag, tools } from '@etb/registry';
import { SURFACES, type Surface } from '@etb/registry/schema';

import { loadToolFlags } from '../../../../lib/flags';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await loadToolFlags();
  const surface = new URL(request.url).searchParams.get('surface');
  if (surface !== null && !SURFACES.includes(surface as Surface)) {
    return Response.json(
      {
        type: 'about:blank',
        title: 'Unknown surface',
        status: 400,
        detail: `surface is one of: ${SURFACES.join(', ')}`,
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }
  const list = tools
    .filter(isListed)
    .filter((tool) => surface === null || surfacesOf(tool).includes(surface as Surface))
    .map((tool) => {
      const flag = toolFlag(tool.id);
      return {
        id: tool.id,
        name: tool.name,
        category: tool.category,
        status: statusOf(tool),
        runtime: tool.runtime,
        surfaces: surfacesOf(tool),
        accepts: tool.accepts ?? [],
        limits: limitsOf(tool) ?? null,
        cost: costOf(tool),
        ...(flag?.maintenanceMessage && { maintenance: flag.maintenanceMessage }),
      };
    });
  return Response.json({ tools: list }, { headers: { 'Cache-Control': 'public, max-age=30' } });
}

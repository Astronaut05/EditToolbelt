/**
 * GET /api/v1/tools/:id (docs/06): one tool, with the JSON Schema of a job's
 * `options` so a client can build its form. Anonymous.
 */
import type { ToolDetail } from '@etb/core/api';
import { isListed, tools } from '@etb/registry';

import { loadToolFlags } from '../../../../../lib/flags';
import { ApiError, preflight, route } from '../../../../../server/api';
import { toolDetail } from '../../../../../server/tools';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

type Context = { params: Promise<{ id: string }> };

export const GET = route('tools.get', async (_request, { params }: Context) => {
  await loadToolFlags();
  const { id } = await params;
  const tool = tools.find((candidate) => candidate.id === id);
  if (!tool || !isListed(tool)) throw new ApiError(404, 'NOT_FOUND', 'No such tool');
  const detail: ToolDetail = toolDetail(tool);
  return Response.json(detail, { headers: { 'Cache-Control': 'public, max-age=30' } });
});

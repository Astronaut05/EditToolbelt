/**
 * Tools as the API shows them (docs/06 → `GET /tools`, `GET /tools/:id`): the
 * registry with the admin's overrides applied (at most 30 s old; the caller
 * loads them first).
 */
import { z } from 'zod';

import type { Tool, ToolDetail } from '@etb/core/api';
import {
  costOf,
  hasServerPath,
  isAvailable,
  limitsOf,
  maintenanceMessage,
  statusOf,
  surfacesOf,
  type ToolDef,
} from '@etb/registry';
import { serverOptions, uploadOptions, type ServerToolId } from '@etb/registry/options';

export function toolView(tool: ToolDef): Tool {
  const maintenance = maintenanceMessage(tool);
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
    status: statusOf(tool),
    runtime: tool.runtime,
    surfaces: [...surfacesOf(tool)],
    accepts: tool.accepts ?? [],
    limits: limitsOf(tool) ?? null,
    cost: costOf(tool),
    server: isAvailable(tool) && hasServerPath(tool),
    ...(maintenance && { maintenance }),
  };
}

const isServerTool = (id: string): id is ServerToolId => Object.hasOwn(serverOptions, id);

/** One tool, with the JSON Schema of a job's options when it has a server side. */
export function toolDetail(tool: ToolDef): ToolDetail {
  return {
    ...toolView(tool),
    options: isServerTool(tool.id)
      ? z.toJSONSchema(serverOptions[tool.id], { io: 'input', unrepresentable: 'any' })
      : null,
    extra_uploads: isServerTool(tool.id)
      ? (uploadOptions[tool.id] ?? []).map((upload) => upload.option)
      : [],
  };
}

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseReadme } from './readme';
import { toolDefSchema } from './schema';
import { tools } from './tools';

const readme = parseReadme(
  readFileSync(new URL('../../../tools/README.md', import.meta.url), 'utf8'),
);

describe('registry entries', () => {
  it.each(tools.map((tool) => [tool.code, tool] as const))(
    '%s matches the schema',
    (_code, tool) => {
      const result = toolDefSchema.safeParse(tool);
      if (!result.success) {
        throw new Error(
          result.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('\n'),
        );
      }
    },
  );

  it('has unique ids, slugs and codes', () => {
    for (const key of ['id', 'slug', 'code'] as const) {
      const values = tools.map((tool) => tool[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it('only relates to tools that exist', () => {
    const ids = new Set(tools.map((tool) => tool.id));
    for (const tool of tools) {
      for (const id of tool.related) expect(ids.has(id), `${tool.id} → ${id}`).toBe(true);
    }
  });
});

describe('registry ↔ tools/README.md', () => {
  it('reads all 75 tools from the README', () => {
    expect(readme).toHaveLength(75);
  });

  it('has exactly the codes in the README', () => {
    expect(tools.map((tool) => tool.code).sort()).toEqual(readme.map((row) => row.code).sort());
  });

  it.each(readme.map((row) => [row.code, row] as const))(
    '%s agrees with its README row',
    (code, row) => {
      const tool = tools.find((candidate) => candidate.code === code);
      expect(tool, `${code} is missing from the registry`).toBeDefined();
      if (!tool) return;
      expect({
        slug: tool.slug,
        category: tool.category,
        wave: tool.wave,
        runtime: tool.runtime,
        surfaces: [...tool.surfaces].sort(),
        costKind: tool.cost.kind,
      }).toEqual({
        slug: row.slug,
        category: row.category,
        wave: row.wave,
        runtime: row.runtime,
        surfaces: [...row.surfaces].sort(),
        costKind: row.costKind,
      });
    },
  );

  it('keeps README order within each category', () => {
    expect(tools.map((tool) => tool.code)).toEqual(
      readme.map((row) => row.code).filter((code) => tools.some((tool) => tool.code === code)),
    );
  });
});

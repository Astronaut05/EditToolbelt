import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENDPOINTS } from '@etb/core/api';

const API = fileURLToPath(new URL('../app/api/v1', import.meta.url));

describe('the documented endpoints', () => {
  it('each have a route that answers their method and preflights', () => {
    for (const endpoint of ENDPOINTS) {
      const dir = endpoint.path.replace(/\{(\w+)\}/g, '[$1]');
      const source = readFileSync(`${API}${dir}/route.server.ts`, 'utf8');
      const method = endpoint.method.toUpperCase();
      expect(source, `${method} ${endpoint.path}`).toMatch(
        new RegExp(`export (const ${method} =|async function ${method}\\()`),
      );
      expect(source, `OPTIONS ${endpoint.path}`).toContain('export const OPTIONS = preflight;');
    }
  });
});

/**
 * Parses the master tool list in tools/README.md, so tests can hold the
 * registry to it (docs/02 → "A CI check fails if any registry entry is missing
 * from tools/README.md or vice versa").
 */
import type { CategoryId, Runtime, Surface } from './schema';

export interface ReadmeRow {
  code: string;
  name: string;
  slug: string;
  wave: number;
  runtime: Runtime;
  category: CategoryId;
  surfaces: Surface[];
  costKind: 'free' | 'flat' | 'perMinute' | 'perMegapixel';
}

const SECTION_CATEGORY: Record<string, CategoryId> = {
  Photo: 'photo',
  Video: 'video',
  Audio: 'audio',
  Color: 'color',
  'Subtitles & Time': 'subtitles-time',
  Utility: 'utility',
};

const RUNTIME: Record<string, Runtime> = {
  client: 'client',
  hybrid: 'hybrid',
  cpu: 'server-cpu',
  gpu: 'server-gpu',
};

const SURFACE: Record<string, Surface> = { W: 'web', M: 'mobile', P: 'panel', A: 'api' };

function costKind(text: string): ReadmeRow['costKind'] {
  if (text === '—' || text === '-') return 'free';
  if (/per \d+ output MP/.test(text)) return 'perMegapixel';
  if (/\/min/.test(text)) return 'perMinute';
  if (/flat/.test(text)) return 'flat';
  throw new Error(`Unrecognised cost in tools/README.md: ${text}`);
}

export function parseReadme(markdown: string): ReadmeRow[] {
  const rows: ReadmeRow[] = [];
  let category: CategoryId | undefined;
  for (const line of markdown.split('\n')) {
    const heading = /^## (.+?) — `tools\//.exec(line);
    if (heading) {
      category = SECTION_CATEGORY[heading[1] ?? ''];
      continue;
    }
    if (!category || !/^\| [PVACTU]\d{2} \|/.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [code, name, slug, wave, runtime, , cost, surfaces] = cells;
    const mappedRuntime = RUNTIME[runtime ?? ''];
    if (!code || !name || !slug || !wave || !mappedRuntime || cost === undefined || !surfaces) {
      throw new Error(`Can't parse tools/README.md row: ${line}`);
    }
    rows.push({
      code,
      name,
      slug: slug.replace(/`/g, ''),
      wave: Number(wave),
      runtime: mappedRuntime,
      category,
      surfaces: surfaces.split(/\s+/).map((letter) => {
        const surface = SURFACE[letter];
        if (!surface) throw new Error(`Unknown surface ${letter} in: ${line}`);
        return surface;
      }),
      costKind: costKind(cost),
    });
  }
  return rows;
}

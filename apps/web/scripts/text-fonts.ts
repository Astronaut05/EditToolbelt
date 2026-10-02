/**
 * Copies Add Text to Image's font files (packages/engines/src/image/text-fonts.ts)
 * from their Fontsource packages to public/fonts/text (git-ignored), where the
 * site serves them from its own origin. Runs before `build` and `dev`; files
 * already in place are left alone.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fontFile,
  TEXT_FONTS,
  TEXT_SUBSETS,
  TEXT_WEIGHTS,
} from '../../../packages/engines/src/image/text-fonts.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'fonts', 'text');
const require = createRequire(join(web, 'package.json'));
mkdirSync(out, { recursive: true });

let copied = 0;
for (const font of TEXT_FONTS) {
  const files = dirname(require.resolve(`${font.pkg}/package.json`));
  for (const [subset] of TEXT_SUBSETS) {
    for (const weight of font.variable ? [400] : TEXT_WEIGHTS) {
      const name = fontFile(font, subset, weight);
      const from = join(files, 'files', name);
      const to = join(out, name);
      if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
      copyFileSync(from, to);
      copied += 1;
    }
  }
}
process.stdout.write(`Text fonts: ${copied === 0 ? 'up to date' : `${String(copied)} copied`}\n`);

// The entry point, not the package: pages that only need a URL don't load the
// modules @etb/core runs code in when it loads (timecode's rates, social sizes).
import { joinUrl } from '@etb/core/urls';

// Both are validated in next.config.ts and inlined at build time, so these
// work in server and client components alike.
function inlined(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} was not inlined at build time; check next.config.ts`);
  }
  return value;
}

/** Absolute URL on this site, for canonical, sitemap, OG, JSON-LD and robots.txt. */
export function absoluteUrl(path: string): string {
  return joinUrl(inlined('SITE_URL', process.env.SITE_URL), path);
}

/** URL of a model or WASM file under MODELS_BASE_URL. */
export function modelUrl(file: string): string {
  return joinUrl(inlined('MODELS_BASE_URL', process.env.MODELS_BASE_URL), file);
}

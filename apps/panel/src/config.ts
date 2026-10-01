/**
 * Where the panel's API lives and its version, set when it's built
 * (scripts/build.ts, from SITE_URL): no host in code (docs/01 → Hosting).
 */
declare const __SITE_URL__: string | undefined;
declare const __PANEL_VERSION__: string | undefined;

export const SITE_URL: string =
  typeof __SITE_URL__ === 'string' ? __SITE_URL__ : 'http://localhost:3000';
export const API_URL = `${SITE_URL}/api/v1`;
export const PANEL_VERSION: string =
  typeof __PANEL_VERSION__ === 'string' ? __PANEL_VERSION__ : '0.0.0';

/**
 * The EditToolbelt panel for Premiere (M7; docs/01 → Premiere panel): a thin
 * client over the public API, plus calculators and text tools from the
 * website's own code. Built by scripts/build.ts into a UXP plugin.
 */
import { createClient } from '@etb/api-client';

import { API_URL, PANEL_VERSION, SITE_URL } from './config';
import { detectHost } from './host';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root) {
  startApp(root, {
    host: detectHost(),
    makeClient: (apiKey) => createClient({ baseUrl: API_URL, apiKey }),
    siteUrl: SITE_URL,
    version: PANEL_VERSION,
  });
}

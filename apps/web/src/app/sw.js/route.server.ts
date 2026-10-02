/**
 * /sw.js for the server build (the static build writes the file in
 * scripts/postbuild.ts). Android's share sheet POSTs the shared files to
 * /share, and only a service worker can take them on the device: without
 * one, they would go to our server. This worker keeps the share target and
 * the models cache only, so pages, signed-in ones included, always come from
 * the network (scripts/sw.ts).
 */
import { serviceWorker } from '../../../scripts/sw.ts';
import { originOf } from '../../lib/csp';

export const dynamic = 'force-static';

const SOURCE = serviceWorker({
  precache: [],
  modelsOrigin: originOf(process.env.MODELS_BASE_URL),
  shell: false,
});

export function GET() {
  return new Response(SOURCE, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

/**
 * /favicon.ico for the server build (the static build writes the file in
 * scripts/postbuild.ts): the 32 px icon wrapped as an .ico. Browsers ask for
 * it on their own, and without it the request falls through to the tool route.
 */
import { pngToIco } from '../../../scripts/ico.ts';
import { GET as icon } from '../icons/[name]/route';

export const dynamic = 'force-static';

export async function GET(request: Request) {
  const png = await icon(request, { params: Promise.resolve({ name: 'favicon-32.png' }) });
  const ico = pngToIco(Buffer.from(await png.arrayBuffer()), 32);
  return new Response(new Uint8Array(ico), {
    headers: { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' },
  });
}

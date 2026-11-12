/**
 * docs/07 → Health endpoints: the process is up, which commit it runs (CI
 * waits for it after a deploy), and whether the site is public or private
 * (SITE_ACCESS), so the checks from outside know what to expect of it.
 */
import { siteAccess } from '../../server/access';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      status: 'ok',
      version: process.env.APP_VERSION ?? 'dev',
      access: siteAccess(process.env),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** docs/07 → Health endpoints: the process is up, and which commit it runs (CI waits for it after a deploy). */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', version: process.env.APP_VERSION ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

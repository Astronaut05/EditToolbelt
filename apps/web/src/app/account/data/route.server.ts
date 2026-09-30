/**
 * "Download my data" (docs/04 → Data export, docs/08 → rights): the signed-in
 * user's data as one JSON file.
 */
import { currentUser, exportAccount } from '../../../server/account';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await currentUser();
  if (!me) {
    return Response.json(
      { type: 'about:blank', title: 'Sign in first', status: 401 },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }
  const data = await exportAccount(me.user.id);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="edittoolbelt-data-${day}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

import { headerRules, renderHeaders } from '../../lib/headers';

// Emits `out/_headers` (the %5F keeps the leading underscore; plain `_x`
// folders are private in the App Router).
export const dynamic = 'force-static';

export function GET() {
  return new Response(renderHeaders(headerRules()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

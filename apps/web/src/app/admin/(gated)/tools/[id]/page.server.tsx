import { notFound } from 'next/navigation';

import { eq, toolFlags } from '@etb/db';
import { statusOf, tools, toolPath } from '@etb/registry';
import { STATUSES, SURFACES } from '@etb/registry/schema';
import { Button } from '@etb/ui';

import {
  AdminFrame,
  Facts,
  ReasonField,
  Section,
  when,
} from '../../../../../components/admin/AdminFrame';
import { loadToolFlags } from '../../../../../lib/flags';
import { requireAdmin } from '../../../../../server/admin';
import { db } from '../../../../../server/db';
import { hasView } from '../../../../../tools/ids';
import { saveToolFlag } from '../../actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const field = 'h-11 rounded-control border border-border bg-bg px-3 text-16';

/** One tool's runtime overrides (docs/07 → Tools; docs/04 → tool_flags). */
export default async function AdminTool({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const tool = tools.find((candidate) => candidate.id === id);
  if (!tool) notFound();
  await loadToolFlags();
  const query = await searchParams;
  const [flag] = await db().select().from(toolFlags).where(eq(toolFlags.toolId, tool.id));
  const opens = hasView(tool.id);
  const statuses = STATUSES.filter((status) => opens || (status !== 'live' && status !== 'beta'));
  const server = tool.runtime !== 'client';

  return (
    <AdminFrame title={`${tool.code} · ${tool.name}`} current="/admin/tools">
      {query.saved === '1' && <p role="status">Saved. The site shows it within 30 seconds.</p>}
      {typeof query.error === 'string' && <p role="alert">Not saved: {query.error}</p>}
      <Facts
        items={[
          [
            'Page',
            <a key="page" href={toolPath(tool)} className="underline underline-offset-4">
              {toolPath(tool)}
            </a>,
          ],
          ['Default status', tool.status],
          ['Status now', statusOf(tool)],
          ['Runtime', tool.runtime],
          ['Surfaces', tool.surfaces.join(', ')],
          ['Last change', flag ? when(flag.updatedAt) : 'never'],
        ]}
      />
      <Section title="Overrides">
        <form action={saveToolFlag} className="flex max-w-xl flex-col gap-4">
          <input type="hidden" name="toolId" value={tool.id} />
          <label className="flex flex-col gap-1.5 text-14">
            <span className="font-strong">Status</span>
            <select name="status" defaultValue={flag?.status ?? 'default'} className={field}>
              <option value="default">Default ({tool.status})</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {!opens && (
              <span className="text-text-muted">
                No page yet, so it can only be soon or disabled.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-14">
            <span className="font-strong">Maintenance message (shown on the tool page)</span>
            <textarea
              name="maintenanceMessage"
              maxLength={300}
              rows={2}
              defaultValue={flag?.maintenanceMessage ?? ''}
              className="rounded-control border border-border bg-bg p-3 text-16"
            />
          </label>
          <fieldset className="flex flex-col gap-1.5 text-14">
            <legend className="font-strong">Surfaces (none ticked: the default)</legend>
            <div className="flex flex-wrap gap-4">
              {SURFACES.map((surface) => (
                <label key={surface} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="surfaces"
                    value={surface}
                    defaultChecked={flag?.surfacesOverride?.includes(surface) ?? false}
                    className="size-4.5 accent-(--accent)"
                  />
                  {surface}
                </label>
              ))}
            </div>
          </fieldset>
          {server && (
            <label className="flex min-h-11 items-center gap-2 text-14">
              <input
                type="checkbox"
                name="serverEnabled"
                defaultChecked={flag?.serverEnabled ?? false}
                className="size-4.5 accent-(--accent)"
              />
              Server path on (where the tool has one)
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-14">
            <span className="font-strong">
              Cost override, JSON (empty: {JSON.stringify(tool.cost)})
            </span>
            <textarea
              name="costOverride"
              rows={2}
              defaultValue={flag?.costOverride ? JSON.stringify(flag.costOverride) : ''}
              className="rounded-control border border-border bg-bg p-3 font-mono text-14"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-14">
            <span className="font-strong">
              Limits override, JSON (empty: {JSON.stringify(tool.limits ?? {})})
            </span>
            <textarea
              name="limitsOverride"
              rows={3}
              defaultValue={flag?.limitsOverride ? JSON.stringify(flag.limitsOverride) : ''}
              className="rounded-control border border-border bg-bg p-3 font-mono text-14"
            />
          </label>
          <ReasonField />
          <Button type="submit" variant="primary" className="self-start">
            Save
          </Button>
        </form>
      </Section>
    </AdminFrame>
  );
}

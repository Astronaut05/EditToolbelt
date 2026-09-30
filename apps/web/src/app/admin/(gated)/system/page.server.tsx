import { sql, systemChecks } from '@etb/db';
import { Button } from '@etb/ui';

import {
  AdminFrame,
  Facts,
  ReasonField,
  Section,
  Table,
  when,
} from '../../../../components/admin/AdminFrame';
import { db } from '../../../../server/db';
import { serverEnv } from '../../../../server/env';
import { runLedgerCheck } from '../actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Drizzle's own table of applied migrations; empty before the first `db:migrate`. */
async function migrations(): Promise<{ applied: number; last: Date | null }> {
  try {
    const result = await db().execute<{ applied: string; last: string | null }>(
      sql`select count(*) as applied, max(created_at) as last from drizzle.__drizzle_migrations`,
    );
    const row = result.rows[0];
    return {
      applied: Number(row?.applied ?? 0),
      last: row?.last ? new Date(Number(row.last)) : null,
    };
  } catch {
    return { applied: 0, last: null };
  }
}

/**
 * docs/07 → System: the config in effect (never a secret), versions,
 * migrations and the scheduled checks. The retention sweeper and bucket
 * lifecycle rows arrive with M4's storage.
 */
export default async function AdminSystem({ searchParams }: Props) {
  const env = serverEnv();
  const query = await searchParams;
  const [migrated, checks, version] = await Promise.all([
    migrations(),
    db().select().from(systemChecks).orderBy(systemChecks.name),
    db().execute<{ server_version: string }>(sql`show server_version`),
  ]);
  const on = (value: unknown) => (value ? 'on' : 'off');

  return (
    <AdminFrame title="System" current="/admin/system">
      {query.saved === '1' && <p role="status">Check run. It’s in the audit log.</p>}
      {query.error === 'reason' && <p role="alert">Give a reason of at least 3 characters.</p>}
      <Section title="Config in effect">
        <Facts
          items={[
            ['Environment', env.APP_ENV],
            ['Version', env.APP_VERSION],
            ['Build', process.env.ETB_TARGET ?? 'static'],
            ['Site URL', env.SITE_URL],
            ['Models from', env.MODELS_BASE_URL],
            ['Log level', env.LOG_LEVEL],
            ['Analytics', env.ANALYTICS_URL ? `on (${new URL(env.ANALYTICS_URL).host})` : 'off'],
            ['Google sign-in', on(env.GOOGLE_CLIENT_ID)],
            [
              'Sign-in email',
              env.SMTP_URL
                ? `SMTP (${new URL(env.SMTP_URL).host})`
                : env.MAIL_OUTBOX_DIR
                  ? 'written to a folder (test)'
                  : 'none',
            ],
            ['Admin IP allowlist', on(process.env.ADMIN_IP_ALLOWLIST)],
            ['Postgres', version.rows[0]?.server_version ?? 'unknown'],
            ['Migrations applied', `${String(migrated.applied)}, last ${when(migrated.last)}`],
          ]}
        />
      </Section>
      <Section title="Scheduled checks">
        {checks.length === 0 ? (
          <p className="text-14 text-text-muted">No check has run yet.</p>
        ) : (
          <Table head={['Check', 'Result', 'Ran', 'Detail']}>
            {checks.map((check) => (
              <tr key={check.name}>
                <td className="font-mono text-12">{check.name}</td>
                <td>{check.ok ? 'OK' : 'Failing'}</td>
                <td>{when(check.ranAt)}</td>
                <td className="font-mono text-12">{JSON.stringify(check.detail)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-14 text-text-muted">
          The retention sweeper and the bucket lifecycle rules report here from M4.
        </p>
      </Section>
      <Section title="Ledger check">
        <p className="text-14 text-text-muted">
          Every balance must equal the sum of its ledger rows. It runs nightly; run it now if
          something looks off.
        </p>
        <form action={runLedgerCheck} className="flex max-w-md flex-col gap-3">
          <ReasonField />
          <Button type="submit" className="self-start">
            Run the ledger check
          </Button>
        </form>
      </Section>
    </AdminFrame>
  );
}

/**
 * Makes an existing account an admin: `pnpm admin:promote you@example.com`.
 * Sign in once first so the account exists. The admin then sets up TOTP at
 * /admin/two-factor before the admin opens. Written to the audit log, with the
 * account as its own actor (there's no admin yet to name).
 *
 *   --demote   takes the role away instead.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
const email = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const demote = process.argv.includes('--demote');
if (!url || !email) {
  process.stderr.write(
    'Usage: DATABASE_URL=… pnpm admin:promote <email> [--demote]\n(on the local stack: docker compose exec web pnpm admin:promote <email>)\n',
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  const role = demote ? 'user' : 'admin';
  const result = await client.query<{ id: string }>(
    'update users set role = $1, updated_at = now() where email = $2 and deleted_at is null returning id',
    [role, email],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    await client.query('rollback');
    process.stderr.write(
      'No active account with that email. Sign in once first, then run this again.\n',
    );
    process.exit(1);
  }
  await client.query(
    `insert into admin_audit_log (admin_id, action, target_type, target_id, after, reason)
     values ($1, $2, 'user', $1, $3, 'Changed from the command line (pnpm admin:promote)')`,
    [id, demote ? 'user.demote' : 'user.promote', JSON.stringify({ role })],
  );
  await client.query('commit');
  process.stdout.write(
    demote
      ? 'Done: the account is a user again.\n'
      : 'Done: the account is an admin. Open /admin and set up two-factor.\n',
  );
} finally {
  await client.end();
}

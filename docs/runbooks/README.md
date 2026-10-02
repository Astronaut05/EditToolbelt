# Runbooks

What to do when something goes wrong (`docs/11` → Backups and recovery, Incident basics). Each page is short, in the order you'd do things, with the commands to run. Until Go public everything runs on Astro's PC with `docker compose`, so the commands are for the local stack; production hosting adds its own steps when it exists.

| When | Read |
|---|---|
| An alert arrives (Telegram or email) | [alerts.md](alerts.md) |
| A tool misbehaves and must stop now | [disable-a-tool.md](disable-a-tool.md) |
| A job is stuck, or someone asks about one | [stuck-job.md](stuck-job.md) |
| Workers must stop (deploy, maintenance, a bad release) | [drain-workers.md](drain-workers.md) |
| The database is lost or damaged | [restore-database.md](restore-database.md) |
| A secret leaked, or it's time to rotate | [rotate-secrets.md](rotate-secrets.md) |
| Turning payments on (Paddle, Click, Payme), or off again | [turn-on-payments.md](turn-on-payments.md) |
| Payment webhooks stop arriving (from M5) | [webhook-outage.md](webhook-outage.md) |
| Personal data may have leaked | [data-breach.md](data-breach.md) |

Rules that hold in every runbook:

- Every admin change takes a reason; it lands in the audit log (Admin → Audit log).
- Never download or open a user's file to debug. Admins have no file access by design (`docs/07`); the job's metadata, options and probe are enough.
- Never edit the credit ledger by hand. Grants and refunds go through Admin → Users (or cancel the job), so each one is a ledger row.

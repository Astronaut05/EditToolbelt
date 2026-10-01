# Restore the database

There are no user files to restore: by design, files live at most an hour (`docs/08`). The database holds accounts, the ledger, purchases, jobs and the audit log.

## Local stack (until Go public)

Backup (run daily; keep a week):

```sh
docker compose exec -T postgres pg_dump -U etb -Fc etb > etb-$(date +%F).dump
```

Restore:

1. Stop what writes: `docker compose stop web worker`.
2. `docker compose exec -T postgres dropdb -U etb --force etb && docker compose exec -T postgres createdb -U etb etb`
3. `docker compose exec -T postgres pg_restore -U etb -d etb --no-owner < etb-YYYY-MM-DD.dump`
4. `docker compose run --rm migrate` (applies anything newer than the dump).
5. `docker compose up -d web worker`, then Admin → System → "Run the ledger check". It must show no mismatches.
6. Jobs that were queued or running at backup time come back as such: the reaper and expiry settle them (credits back) within 15 min.

## Production

Daily full backups with 7 days of point-in-time recovery, and a weekly automated restore test (`docs/11`). Steps arrive with the hosting choice at Go public.

# Alerts

Every alert names its rule and subject. The same rule and subject alert at most once in 30 minutes (except a ledger mismatch, which alerts at once). Admin → System lists the last 20 and where each went.

## heartbeat_missing: "<service> <instance> last seen … ago"

A worker (or the web) stopped writing its heartbeat for 2 minutes.

1. `docker compose ps`: is the service up? `docker compose logs --tail 100 worker`.
2. Crashed: `docker compose up -d worker`. Its running job is requeued by another worker's reaper after 60 s, or by this one when it's back.
3. Up but silent: the database is likely unreachable from it; see db_connections.
4. A heartbeat that was removed on a clean stop never alerts; this means it died.

## db_connections: "Postgres is at N % of max connections"

1. `docker compose exec postgres psql -U etb -c "select application_name, state, count(*) from pg_stat_activity group by 1, 2 order by 3 desc"`.
2. Many `idle in transaction`: a stuck process; restart the service that owns them.
3. Many web connections: lower the pool size or add PgBouncer before Go public.

## disk: "The worker's disk is N % full"

Job temp folders live under the worker's temp dir and are deleted after every job, whatever happens.

1. `docker compose exec worker sh -c 'df -h /tmp; du -sh /tmp/etb-* 2>/dev/null | sort -h | tail'`.
2. Leftover `etb-job-*` folders older than the longest job timeout are from a killed worker: delete them.
3. Still full: fewer `WORKER_SLOTS`, or a bigger disk.

## tool_failure_rate: "<tool>: N of M server jobs failed in the last 30 min"

1. Admin → Jobs, filter by the tool and `failed`: read the error codes.
2. One code everywhere (TOOL_FAILED, TIMEOUT): a broken processor or ffmpeg. Put the tool in maintenance ([disable-a-tool.md](disable-a-tool.md)) while you look.
3. DECODE_FAILED / UNSUPPORTED_FORMAT from different users: bad files, not our bug; nothing to do unless it grows.
4. Failed jobs have already refunded their credits; nobody needs a manual refund.

## queue_wait: "p95 queue wait is N s over the last 10 min"

1. Admin → Dashboard: waiting and running now. Admin → Jobs filtered by `queued`.
2. Running is 0 with jobs waiting: no worker is claiming; see heartbeat_missing.
3. Every slot busy: add `WORKER_SLOTS` (one tool process each; mind the CPU), or start a second worker.
4. One tool hogging: its `maxConcurrent` cap in the registry (or a limits override in Admin → Tools).

## ledger_mismatch: "N account(s) have a balance that doesn't match their ledger"

Serious: money is wrong somewhere. Don't touch balances by hand.

1. Admin → System → "Run the ledger check" to confirm it's still there, and note the user ids it lists.
2. For each: Admin → Users → the account's ledger. Compare the cached balance with the sum of rows; find the job or purchase where they part.
3. A code path changed a balance without a ledger row: that's the bug. Fix it, then correct the balance with an admin grant or debit (reason: the incident), so the ledger explains the fix.

## sweeper_stale, storage_old_objects, storage_open_uploads

The retention sweeper (every 5 min) hasn't finished in 30 min, or objects older than 2 hours or uploads open longer than 2 hours are in the bucket. Users' files must not stay (`docs/08`): treat this as urgent.

1. `docker compose logs --tail 200 worker | grep retention`.
2. Storage unreachable: `curl -s localhost:3000/readyz`. Fix storage first; the sweeper catches up on its own.
3. Old objects that no row points to: the sweeper only deletes what the database knows. List them (`aws s3 ls` with the stack's keys, or the gateway's console) and delete them; then find how they got there.

## lifecycle_missing

The bucket's backstop rules (1-day expiry, 1-day multipart abort) are missing on R2. Locally the gateway has none and this reads "not supported", which is fine. On R2, set both rules in the bucket's settings.

## gpu_budget: "GPU spend is $X of today's $Y budget" / "GPU budget reached"

Once a day each, at 80 % and at 100 % of the day's GPU budget (UTC). At 100 % GPU jobs wait instead of starting. See [gpu-budget.md](gpu-budget.md).

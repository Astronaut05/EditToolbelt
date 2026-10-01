"""Once-a-day jobs: the ledger check, the account scrub, retention purges and the digest.

Each writes its result to ``system_checks`` (the admin's System page) and
runs inside the scheduler's lock, so only one worker does it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from psycopg import sql

from etb_worker.alerts import ledger_mismatch, raise_alert
from etb_worker.clock import day_bounds, local
from etb_worker.db import Conn, record_check
from etb_worker.logs import get_logger
from etb_worker.notify import Notifier
from etb_worker.retention import lifecycle_check
from etb_worker.storage import Storage

GRACE_DAYS = 30


@dataclass(frozen=True)
class TaskContext:
    notifier: Notifier
    now: datetime
    storage: Storage | None = None


def ledger_check(conn: Conn, ctx: TaskContext) -> None:
    """Every balance equals the sum of its ledger rows (docs/05); a mismatch alerts at once."""
    rows = conn.execute(
        """
        select u.id::text as user_id
        from users u
        left join credit_transactions t on t.user_id = u.id
        group by u.id
        having u.credit_balance <> coalesce(sum(t.amount), 0)
        order by u.id
        """
    ).fetchall()
    ids = [row["user_id"] for row in rows]
    # Same shape as the admin's "Run the ledger check" button.
    record_check(
        conn, "ledger_invariant", ok=not ids, detail={"mismatches": len(ids), "users": ids[:10]}
    )
    get_logger().info("task.ledger_invariant", mismatches=len(ids))
    if ids:
        raise_alert(conn, ledger_mismatch(len(ids)), ctx.notifier)


# Better Auth's tables and API keys go entirely; the user row stays as a tombstone.
_SCRUB_TABLES = ("sessions", "accounts", "two_factors", "api_keys")


def account_scrub(conn: Conn, _ctx: TaskContext) -> None:
    """Deleted accounts past the 30-day grace become tombstones (docs/04 -> Account deletion).

    Email, display name and locale are nulled; sessions, sign-in methods, TOTP
    and API keys are hard-deleted. The row's random id stays, so the ledger
    and purchases keep valid references with no UPDATE on the ledger.
    """
    with conn.transaction():
        rows = conn.execute(
            """
            select id from users
            where deleted_at < now() - make_interval(days => %s)
              and (email is not null or display_name is not null
                   or locale is not null or image is not null)
            for update
            """,
            (GRACE_DAYS,),
        ).fetchall()
        ids = [row["id"] for row in rows]
        if ids:
            for table in _SCRUB_TABLES:
                conn.execute(
                    sql.SQL("delete from {} where user_id = any(%s)").format(sql.Identifier(table)),
                    (ids,),
                )
            conn.execute(
                """
                update users
                set email = null, display_name = null, locale = null, image = null,
                    email_verified = false, marketing_opt_in = false,
                    two_factor_enabled = false, updated_at = now()
                where id = any(%s)
                """,
                (ids,),
            )
        record_check(conn, "account_scrub", ok=True, detail={"scrubbed": len(ids)})
    get_logger().info("task.account_scrub", scrubbed=len(ids))


# (what, SQL): each deletes rows past their retention (docs/08 -> What we keep).
_PURGES: tuple[tuple[str, str], ...] = (
    (
        "welcome_grant_claims",
        "delete from welcome_grant_claims where claimed_at < now() - interval '12 months'",
    ),
    ("verifications", "delete from verifications where expires_at < now() - interval '1 day'"),
    ("sessions", "delete from sessions where expires_at < now()"),
    ("heartbeats", "delete from service_heartbeats where seen_at < now() - interval '1 day'"),
    ("alerts", "delete from alerts where created_at < now() - interval '90 days'"),
)


def retention_purge(conn: Conn, _ctx: TaskContext) -> None:
    """Welcome-grant claims after 12 months, expired sign-in links and sessions, old alerts."""
    counts: dict[str, int] = {}
    with conn.transaction():
        for what, statement in _PURGES:
            counts[what] = conn.execute(statement).rowcount
        record_check(conn, "retention_purge", ok=True, detail=counts)
    get_logger().info("task.retention_purge", **counts)


def digest_stats(conn: Conn, day: date) -> dict[str, Any]:
    """Yesterday's numbers for the digest (docs/07): one Tashkent calendar day."""
    start, end = day_bounds(day)
    span = (start, end)
    jobs = conn.execute(
        """
        select count(*)::int as finished,
               (count(*) filter (where status = 'failed'))::int as failed
        from jobs
        where finished_at >= %s and finished_at < %s and status in ('succeeded', 'failed')
        """,
        span,
    ).fetchone() or {"finished": 0, "failed": 0}
    top = conn.execute(
        """
        select tool_id, count(*)::int as n from jobs
        where finished_at >= %s and finished_at < %s and status in ('succeeded', 'failed')
        group by tool_id order by n desc, tool_id limit 5
        """,
        span,
    ).fetchall()
    failing = conn.execute(
        """
        select tool_id, count(*)::int as n from jobs
        where finished_at >= %s and finished_at < %s and status = 'failed'
        group by tool_id order by n desc, tool_id limit 5
        """,
        span,
    ).fetchall()
    revenue = conn.execute(
        """
        select currency, sum(amount_minor)::bigint as minor, sum(credits)::bigint as credits
        from purchases
        where status = 'completed' and created_at >= %s and created_at < %s
        group by currency order by currency
        """,
        span,
    ).fetchall()
    users = conn.execute(
        "select count(*)::int as n from users where created_at >= %s and created_at < %s", span
    ).fetchone() or {"n": 0}
    alerts = conn.execute(
        "select count(*)::int as n from alerts where created_at >= %s and created_at < %s", span
    ).fetchone() or {"n": 0}
    checks = conn.execute("select name from system_checks where not ok order by name").fetchall()
    return {
        "day": day.isoformat(),
        "jobs": jobs["finished"],
        "failed": jobs["failed"],
        "top_tools": [(row["tool_id"], row["n"]) for row in top],
        "top_failing": [(row["tool_id"], row["n"]) for row in failing],
        "revenue": [(row["currency"], int(row["minor"])) for row in revenue],
        "credits_sold": sum(int(row["credits"]) for row in revenue),
        "new_users": users["n"],
        "alerts": alerts["n"],
        "failing_checks": [row["name"] for row in checks],
    }


def format_digest(stats: dict[str, Any]) -> str:
    """Plain text, no Markdown: Telegram shows it as is, and so does email."""
    jobs, failed = stats["jobs"], stats["failed"]
    rate = f", {round(100 * failed / jobs)} %" if jobs else ""

    def listing(items: list[tuple[str, int]]) -> str:
        return ", ".join(f"{name} {n}" for name, n in items) or "none"

    revenue = ", ".join(f"{minor / 100:.2f} {currency}" for currency, minor in stats["revenue"])
    lines = [
        f"EditToolbelt daily digest for {stats['day']} (Tashkent day)",
        "",
        f"Server jobs: {jobs} ({failed} failed{rate})",
        f"Top tools: {listing(stats['top_tools'])}",
        f"Top failing tools: {listing(stats['top_failing'])}",
        f"Revenue: {revenue or 'none'} ({stats['credits_sold']} credits sold)",
        f"New users: {stats['new_users']}",
        f"Alerts: {stats['alerts']}",
        f"Failing checks: {', '.join(stats['failing_checks']) or 'none'}",
    ]
    return "\n".join(lines)


def daily_digest(conn: Conn, ctx: TaskContext) -> None:
    """Yesterday's summary at 09:00 Tashkent (docs/07 -> Alerts)."""
    day = local(ctx.now).date() - timedelta(days=1)
    stats = digest_stats(conn, day)
    channels = ctx.notifier.send(f"EditToolbelt digest {stats['day']}", format_digest(stats))
    delivered = bool(channels) or not ctx.notifier.configured
    record_check(
        conn,
        "daily_digest",
        ok=delivered,
        detail={"day": stats["day"], "channels": channels},
    )
    get_logger().info("task.daily_digest", day=stats["day"], channels=channels)


def lifecycle_rules(conn: Conn, ctx: TaskContext) -> None:
    """The bucket's backstop rules are in place (docs/11 -> Storage); "not supported" locally."""
    if ctx.storage is None:
        return
    for alert in lifecycle_check(conn, ctx.storage):
        raise_alert(conn, alert, ctx.notifier)

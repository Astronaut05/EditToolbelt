"""Alert rules (docs/07 -> Alerts) and their 30-minute cool-down.

Each rule is a query that returns what's wrong right now. ``raise_alert``
sends an alert unless the same rule and subject alerted in the last 30
minutes (immediate alerts, like a ledger mismatch, skip the cool-down), and
records it in the ``alerts`` table either way it's sent. One that no channel
delivered, with a channel set up, is recorded as ``undelivered``: nobody was
told, so it starts no cool-down and marks no once-only alert as sent. It is
raised again when its rule next finds it, or by ``undelivered_once`` when no
rule would: at most once a tick, until a channel delivers it. A tick whose
failed sends have cost it 20 s leaves the rest to the next one, each alert
in its turn (``in_turn``, scheduler.check_alerts).

Tool margin (the digest, once jobs have costs) arrives with job costs. The
sweeper's storage checks and the lifecycle rules are raised by retention.py.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from etb_worker.db import Conn
from etb_worker.logs import get_logger
from etb_worker.notify import Notifier

COOL_DOWN = timedelta(minutes=30)
HEARTBEAT_STALE = timedelta(minutes=2)
FAILURE_WINDOW = timedelta(minutes=30)
FAILURE_RATE = 0.10
FAILURE_MIN_JOBS = 10
QUEUE_WINDOW = timedelta(minutes=10)
QUEUE_P95_SEC = 120
USE_LIMIT = 0.80
SWEEPER_STALE = timedelta(minutes=30)
# Paddle retries a failed delivery for 3 days; an error older than that was seen.
WEBHOOK_WINDOW = timedelta(days=3)
WEBHOOK_ALERTS_PER_CHECK = 10
# Click's fiscal receipts: the web server retries them 1, 2, 4 ... minutes apart.
# One still unsent after this many tries, or this long, alerts (once).
FISCAL_ALERT_TRIES = 6
FISCAL_ALERT_AGE = timedelta(hours=1)
FISCAL_ALERTS_PER_CHECK = 10
#: An alert's ``channels`` when a channel is set up and none delivered it. Such a row is
#: not a sent alert: the cool-down and the once-only rules (here and in gpu/budget.py)
#: leave it out, so the alert is still owed. With no channel set up the row holds none,
#: and counts as sent: there is nobody to tell.
UNDELIVERED = ["undelivered"]
#: Alerts raised once, where the thing happens, that no rule finds again: the nightly ledger
#: check's and the reaper's. Undelivered, they are sent again from their rows.
RAISED_ONCE = ["ledger_mismatch", "gpu_call_not_cancelled"]
UNDELIVERED_PER_CHECK = 10


@dataclass(frozen=True)
class Alert:
    rule: str
    subject: str
    message: str
    immediate: bool = False


def raise_alert(conn: Conn, alert: Alert, notifier: Notifier) -> bool:
    """Send and record ``alert`` unless it's cooling down. Returns whether it was raised.

    Not raised either when a channel is set up and none delivered it (Telegram
    timed out, no email behind it): it is recorded as ``UNDELIVERED`` and
    stays owed. The rule that found it finds it again on its next check
    (``undelivered_once`` does for an alert no rule finds again), so that is
    at most one more try a tick for as long as it lasts, and one row, which
    the try that gets through replaces.
    """
    if not alert.immediate:
        recent = conn.execute(
            """
            select 1 from alerts
            where rule = %s and subject = %s and created_at > now() - %s and channels <> %s
            limit 1
            """,
            (alert.rule, alert.subject, COOL_DOWN, UNDELIVERED),
        ).fetchone()
        if recent is not None:
            return False
    channels = notifier.send(f"EditToolbelt alert: {alert.rule}", f"Alert: {alert.message}")
    delivered = bool(channels) or not notifier.configured
    with conn.transaction():
        conn.execute(
            "delete from alerts where rule = %s and subject = %s and channels = %s",
            (alert.rule, alert.subject, UNDELIVERED),
        )
        conn.execute(
            "insert into alerts (rule, subject, message, channels) values (%s, %s, %s, %s)",
            (alert.rule, alert.subject, alert.message, channels if delivered else UNDELIVERED),
        )
    log = get_logger()
    if not delivered:
        log.warning("alert.undelivered", rule=alert.rule, subject=alert.subject)
        return False
    log.warning("alert.raised", rule=alert.rule, subject=alert.subject, channels=channels)
    return True


def stale_heartbeats(conn: Conn) -> list[Alert]:
    """A worker or GPU backend that hasn't checked in for 2 minutes."""
    rows = conn.execute(
        """
        select service, instance, extract(epoch from now() - seen_at)::int as ago
        from service_heartbeats
        where seen_at < now() - %s
        order by service, instance
        """,
        (HEARTBEAT_STALE,),
    ).fetchall()
    return [
        Alert(
            "heartbeat_missing",
            f"{row['service']}/{row['instance']}",
            f"{row['service']} {row['instance']} last checked in {_ago(row['ago'])} ago.",
        )
        for row in rows
    ]


def database_connections(conn: Conn) -> list[Alert]:
    """More than 80 % of Postgres's max_connections in use."""
    row = conn.execute(
        """
        select count(*)::int as used, current_setting('max_connections')::int as max
        from pg_stat_activity
        where backend_type = 'client backend'
        """
    ).fetchone()
    if row is None or row["max"] <= 0 or row["used"] / row["max"] <= USE_LIMIT:
        return []
    percent = round(100 * row["used"] / row["max"])
    return [
        Alert(
            "db_connections",
            "postgres",
            f"Database connections at {percent} % of max ({row['used']} of {row['max']}).",
        )
    ]


def disk_space(path: str, instance: str) -> list[Alert]:
    """More than 80 % of this host's work disk in use."""
    usage = shutil.disk_usage(path)
    if usage.total <= 0 or usage.used / usage.total <= USE_LIMIT:
        return []
    percent = round(100 * usage.used / usage.total)
    free_mb = usage.free // 1_000_000
    return [
        Alert(
            "disk",
            f"worker/{instance}",
            f"Disk at {percent} % on worker {instance} ({path}, {free_mb} MB free).",
        )
    ]


def tool_failure_rates(conn: Conn) -> list[Alert]:
    """A tool's server jobs failing more than 10 % over 30 minutes, with at least 10 jobs."""
    rows = conn.execute(
        """
        select tool_id,
               count(*)::int as finished,
               (count(*) filter (where status = 'failed'))::int as failed
        from jobs
        where finished_at > now() - %s and status in ('succeeded', 'failed')
        group by tool_id
        having count(*) >= %s
           and count(*) filter (where status = 'failed') > count(*) * %s
        order by tool_id
        """,
        (FAILURE_WINDOW, FAILURE_MIN_JOBS, FAILURE_RATE),
    ).fetchall()
    return [
        Alert(
            "tool_failure_rate",
            row["tool_id"],
            f"{row['tool_id']}: {row['failed']} of {row['finished']} server jobs failed "
            f"in the last 30 min ({round(100 * row['failed'] / row['finished'])} %).",
        )
        for row in rows
    ]


def queue_wait(conn: Conn) -> list[Alert]:
    """Queue wait p95 over 2 minutes across the last 10 minutes.

    Counts jobs that started in the window (queued to started) and jobs still
    waiting (queued to now), so a stuck queue alerts too.
    """
    row = conn.execute(
        """
        select count(*)::int as jobs,
               percentile_cont(0.95) within group (order by wait) as p95
        from (
          select extract(epoch from started_at - queued_at) as wait
          from jobs where started_at > now() - %s
          union all
          select extract(epoch from now() - queued_at)
          from jobs where status = 'queued'
        ) waits
        """,
        (QUEUE_WINDOW,),
    ).fetchone()
    if row is None or row["p95"] is None or row["p95"] <= QUEUE_P95_SEC:
        return []
    return [
        Alert(
            "queue_wait",
            "queue",
            f"Queue wait p95 is {row['p95'] / 60:.1f} min over the last 10 min "
            f"({row['jobs']} jobs).",
        )
    ]


def ledger_mismatch(count: int) -> Alert:
    """Immediate, no cool-down (docs/07)."""
    noun = "account's balance doesn't" if count == 1 else "accounts' balances don't"
    return Alert(
        "ledger_mismatch",
        "",
        f"Ledger check: {count} {noun} equal the sum of the ledger. See Admin, System.",
        immediate=True,
    )


def _ago(seconds: int) -> str:
    return f"{seconds // 60} min" if seconds >= 60 else f"{seconds} s"


def sweeper_stale(conn: Conn) -> list[Alert]:
    """The retention sweeper hasn't finished a pass in 30 minutes (docs/07 -> Alerts)."""
    row = conn.execute(
        """
        select extract(epoch from now() - ran_at)::int as ago from system_checks
        where name = 'retention_sweeper' and ran_at < now() - %s
        """,
        (SWEEPER_STALE,),
    ).fetchone()
    if row is None:
        return []
    return [
        Alert(
            "sweeper_stale",
            "retention_sweeper",
            f"The retention sweeper last finished {_ago(row['ago'])} ago; "
            "files may outlive their hour.",
        )
    ]


def webhook_errors(conn: Conn) -> list[Alert]:
    """A payment webhook processed with an error (docs/07 -> Alerts: immediate, no cool-down).

    The error column holds only what a person must look at: a payment that
    wasn't credited, a refund for a purchase in the wrong state, a store
    failure. Once per event: its row in ``alerts`` (rule ``webhook_error``,
    subject the event's id) marks it alerted, so a provider's retries that
    fail the same way don't alert again. An ``UNDELIVERED`` row doesn't: the
    event is still owed. The error text is ours, never the payload.
    """
    rows = conn.execute(
        """
        select e.id::text as id, e.provider, e.type, e.error
        from webhook_events e
        where e.error is not null
          and e.processed_at > now() - %s
          and not exists (
            select 1 from alerts a
            where a.rule = 'webhook_error' and a.subject = e.id::text and a.channels <> %s
          )
        order by e.processed_at
        limit %s
        """,
        (WEBHOOK_WINDOW, UNDELIVERED, WEBHOOK_ALERTS_PER_CHECK),
    ).fetchall()
    return [
        Alert(
            "webhook_error",
            row["id"],
            f"Payment webhook error: {row['provider']} {row['type'][:60]}: {row['error'][:300]}. "
            "See Admin, Payments, Webhook events.",
            immediate=True,
        )
        for row in rows
    ]


def fiscal_receipts_unsent(conn: Conn) -> list[Alert]:
    """A Click fiscal receipt still unsent after 6 tries or an hour (docs/05 -> Payments).

    The web server keeps retrying it until Click accepts it; this tells a
    person once, like ``webhook_errors``: the receipt's row in ``alerts``
    (rule ``fiscal_receipt_unsent``, subject the receipt's id) marks it
    alerted, unless that row is ``UNDELIVERED``. The message names the purchase
    and the last error, which holds our words or Click's code and note, never
    the receipt's body.
    """
    rows = conn.execute(
        """
        select r.id::text as id, r.purchase_id::text as purchase_id, r.attempts, r.last_error
        from fiscal_receipts r
        where r.status <> 'sent'
          and (r.attempts >= %s or r.created_at < now() - %s)
          and not exists (
            select 1 from alerts a
            where a.rule = 'fiscal_receipt_unsent' and a.subject = r.id::text
              and a.channels <> %s
          )
        order by r.created_at
        limit %s
        """,
        (FISCAL_ALERT_TRIES, FISCAL_ALERT_AGE, UNDELIVERED, FISCAL_ALERTS_PER_CHECK),
    ).fetchall()
    alerts = []
    for row in rows:
        error = f", last error: {row['last_error'][:200]}" if row["last_error"] else ""
        alerts.append(
            Alert(
                "fiscal_receipt_unsent",
                row["id"],
                f"Click fiscal receipt not sent: purchase {row['purchase_id']}, "
                f"{row['attempts']} tries{error}. Retries carry on; see Admin, Payments.",
                immediate=True,
            )
        )
    return alerts


def undelivered_once(conn: Conn) -> list[Alert]:
    """An alert raised once that no channel delivered, with the message it was raised with.

    A rule finds what it alerts about again on its next check. Nothing finds
    a ledger mismatch again before the next night's check, or a GPU call that
    couldn't be cancelled ever, so their ``UNDELIVERED`` rows are what's
    owed. Immediate, like the alerts themselves; the try that gets through
    replaces the row, and that ends it.
    """
    rows = conn.execute(
        """
        select rule, subject, message from alerts
        where rule = any(%s) and channels = %s
        order by created_at
        limit %s
        """,
        (RAISED_ONCE, UNDELIVERED, UNDELIVERED_PER_CHECK),
    ).fetchall()
    return [Alert(row["rule"], row["subject"], row["message"], immediate=True) for row in rows]


def in_turn(conn: Conn, found: list[Alert]) -> list[Alert]:
    """``found`` in the order to send it: first what was never tried, in the rules' order,
    then what no channel delivered, the one tried longest ago first.

    A check stops sending once its failed sends have cost it 20 s
    (scheduler.check_alerts). In the rules' own order it would then try the
    same first few alerts on every tick for as long as a channel is down,
    and one behind them, an uncredited payment say, would get no try and no
    ``UNDELIVERED`` row, which is what shows it in Admin, System. A failed
    try writes that row anew, so the oldest row is the alert whose turn it is.
    """
    if not found:
        return []
    rows = conn.execute(
        """
        select rule, subject from alerts
        where channels = %s and (rule, subject) in (select * from unnest(%s::text[], %s::text[]))
        order by created_at, id
        """,
        (UNDELIVERED, [alert.rule for alert in found], [alert.subject for alert in found]),
    ).fetchall()
    turn = {(row["rule"], row["subject"]): at for at, row in enumerate(rows)}
    return sorted(found, key=lambda alert: turn.get((alert.rule, alert.subject), -1))


Rule = Callable[[Conn], list[Alert]]

DATABASE_RULES: tuple[tuple[str, Rule], ...] = (
    ("heartbeat_missing", stale_heartbeats),
    ("db_connections", database_connections),
    ("tool_failure_rate", tool_failure_rates),
    ("queue_wait", queue_wait),
    ("sweeper_stale", sweeper_stale),
    ("webhook_error", webhook_errors),
    ("fiscal_receipt_unsent", fiscal_receipts_unsent),
    ("undelivered_once", undelivered_once),
)

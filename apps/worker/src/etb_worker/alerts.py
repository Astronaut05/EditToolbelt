"""Alert rules (docs/07 -> Alerts) and their 30-minute cool-down.

Each rule is a query that returns what's wrong right now. ``raise_alert``
sends an alert unless the same rule and subject alerted in the last 30
minutes (immediate alerts, like a ledger mismatch, skip the cool-down), and
records it in the ``alerts`` table either way it's sent.

Rules for things that arrive later are added with them: webhook errors (M5)
and tool margin (the digest, once jobs have costs). The sweeper's storage
checks and the lifecycle rules are raised by retention.py.
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


@dataclass(frozen=True)
class Alert:
    rule: str
    subject: str
    message: str
    immediate: bool = False


def raise_alert(conn: Conn, alert: Alert, notifier: Notifier) -> bool:
    """Send and record ``alert`` unless it's cooling down. Returns whether it was raised."""
    if not alert.immediate:
        recent = conn.execute(
            """
            select 1 from alerts
            where rule = %s and subject = %s and created_at > now() - %s
            limit 1
            """,
            (alert.rule, alert.subject, COOL_DOWN),
        ).fetchone()
        if recent is not None:
            return False
    channels = notifier.send(f"EditToolbelt alert: {alert.rule}", f"Alert: {alert.message}")
    conn.execute(
        "insert into alerts (rule, subject, message, channels) values (%s, %s, %s, %s)",
        (alert.rule, alert.subject, alert.message, channels),
    )
    get_logger().warning("alert.raised", rule=alert.rule, subject=alert.subject, channels=channels)
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


Rule = Callable[[Conn], list[Alert]]

DATABASE_RULES: tuple[tuple[str, Rule], ...] = (
    ("heartbeat_missing", stale_heartbeats),
    ("db_connections", database_connections),
    ("tool_failure_rate", tool_failure_rates),
    ("queue_wait", queue_wait),
    ("sweeper_stale", sweeper_stale),
)

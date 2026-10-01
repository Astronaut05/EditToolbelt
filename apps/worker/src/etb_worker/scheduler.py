"""The worker's scheduler: heartbeats, alert rules and the once-a-day jobs.

Every 30 seconds each worker writes its heartbeat. One worker at a time (a
Postgres advisory lock) then checks the alert rules and runs whatever daily
job is due: the ledger check, account scrub and retention purges at 03:00
Tashkent, the digest at 09:00. When a job last ran lives in
``system_checks``, so restarts don't repeat a job and missed ones catch up.
M4's job queue runs alongside this in the same process.
"""

from __future__ import annotations

import contextlib
import socket
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta

import psycopg

from etb_worker.alerts import DATABASE_RULES, Alert, disk_space, raise_alert
from etb_worker.clock import is_daily_due
from etb_worker.db import Conn, connect
from etb_worker.logs import get_logger
from etb_worker.notify import Notifier
from etb_worker.settings import Settings
from etb_worker.tasks import (
    TaskContext,
    account_scrub,
    daily_digest,
    ledger_check,
    retention_purge,
)

TICK_SEC = 30
# Any constant works; it only has to be the same in every worker.
LOCK_KEY = 0x45544253
NIGHTLY = time(3, 0)
DIGEST_AT = time(9, 0)
RETRY_AFTER = timedelta(minutes=10)
SERVICE = "worker"

Task = Callable[[Conn, TaskContext], None]

DAILY: dict[str, tuple[time, Task]] = {
    "ledger_invariant": (NIGHTLY, ledger_check),
    "account_scrub": (NIGHTLY, account_scrub),
    "retention_purge": (NIGHTLY, retention_purge),
    "daily_digest": (DIGEST_AT, daily_digest),
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Scheduler:
    settings: Settings
    notifier: Notifier
    instance: str = field(default_factory=socket.gethostname)
    connect: Callable[[Settings], Conn] = connect
    clock: Callable[[], datetime] = _utc_now
    disk_path: str = field(default_factory=tempfile.gettempdir)
    # A job that raised waits this long before its next try, in this process.
    _retry_at: dict[str, datetime] = field(default_factory=dict)

    def tick(self) -> None:
        """One round. Database outages are logged, never raised: the next tick tries again."""
        log = get_logger()
        try:
            with self.connect(self.settings) as conn:
                self.beat(conn)
                leader = conn.execute(
                    "select pg_try_advisory_lock(%s) as got", (LOCK_KEY,)
                ).fetchone()
                if not leader or not leader["got"]:
                    return
                try:
                    self.check_alerts(conn)
                    self.run_due(conn)
                finally:
                    conn.execute("select pg_advisory_unlock(%s)", (LOCK_KEY,))
        except psycopg.Error as error:
            log.warning(
                "scheduler.tick_failed", error_code="DB_UNAVAILABLE", detail=type(error).__name__
            )

    def beat(self, conn: Conn) -> None:
        conn.execute(
            """
            insert into service_heartbeats (service, instance, version, seen_at)
            values (%s, %s, %s, now())
            on conflict (service, instance)
              do update set version = excluded.version, seen_at = excluded.seen_at
            """,
            (SERVICE, self.instance, self.settings.app_version),
        )

    def leave(self) -> None:
        """On a clean stop, remove this worker's heartbeat so it doesn't alert as missing."""
        try:
            with self.connect(self.settings) as conn:
                conn.execute(
                    "delete from service_heartbeats where service = %s and instance = %s",
                    (SERVICE, self.instance),
                )
        except psycopg.Error:
            get_logger().warning("scheduler.leave_failed", error_code="DB_UNAVAILABLE")

    def check_alerts(self, conn: Conn) -> None:
        log = get_logger()
        found: list[Alert] = []
        for name, rule in DATABASE_RULES:
            try:
                found += rule(conn)
            except psycopg.Error as error:
                log.warning("alert.rule_failed", rule=name, detail=type(error).__name__)
        try:
            found += disk_space(self.disk_path, self.instance)
        except OSError as error:
            log.warning("alert.rule_failed", rule="disk", detail=type(error).__name__)
        for alert in found:
            raise_alert(conn, alert, self.notifier)

    def run_due(self, conn: Conn) -> None:
        now = self.clock()
        rows = conn.execute("select name, ran_at from system_checks").fetchall()
        last = {row["name"]: row["ran_at"] for row in rows}
        for name, (at, _task) in DAILY.items():
            if self._retry_at.get(name, now) > now:
                continue
            if is_daily_due(last.get(name), now, at):
                self.run(conn, name)

    def run(self, conn: Conn, name: str) -> bool:
        """Runs one daily job now. A job that fails alerts and is retried in 10 minutes."""
        _at, task = DAILY[name]
        log = get_logger(task=name)
        now = self.clock()
        try:
            task(conn, TaskContext(notifier=self.notifier, now=now))
        # One job's failure, a database error or a bug, mustn't stop the others
        # or the heartbeat: log it, alert, and try again in 10 minutes.
        except Exception as error:  # noqa: BLE001
            self._retry_at[name] = now + RETRY_AFTER
            code = "DB_ERROR" if isinstance(error, psycopg.Error) else "TASK_ERROR"
            log.error("task.failed", error_code=code, detail=type(error).__name__)  # noqa: TRY400
            alert = Alert("task_failed", name, f"The {name} job failed ({type(error).__name__}).")
            with contextlib.suppress(
                psycopg.Error
            ):  # if the database is the problem, the log stands
                raise_alert(conn, alert, self.notifier)
            return False
        self._retry_at.pop(name, None)
        return True

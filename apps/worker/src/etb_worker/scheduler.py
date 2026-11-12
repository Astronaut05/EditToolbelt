"""The worker's scheduler: heartbeats, alert rules and the once-a-day jobs.

Every 30 seconds each worker writes its heartbeat. One worker at a time (a
Postgres advisory lock) then looks after the job queue (jobs whose worker
went quiet, and the GPU calls they left running; jobs queued too long; the
inputs of ended jobs that no runner was left to delete),
sweeps storage every 5 minutes, checks the alert rules and runs whatever
daily job is due: the ledger check, account scrub, retention purges and the
bucket's lifecycle rules at 03:00 Tashkent, the digest at 09:00. When a job
last ran lives in ``system_checks``, so restarts don't repeat a job and
missed ones catch up. An alert or a digest that no channel delivered is still
owed: the alert is sent again when its rule next finds it (the next tick),
the digest every 10 minutes. A tick gives the sends that reach nobody 20 s in
all, then leaves the rest of what's owed to the next tick.
The job slots (runner.py) run beside this in the same process.
"""

from __future__ import annotations

import contextlib
import socket
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from time import monotonic

import psycopg

from etb_worker import jobqueue
from etb_worker.alerts import DATABASE_RULES, Alert, disk_space, in_turn, raise_alert
from etb_worker.clock import is_daily_due
from etb_worker.db import Conn, connect, long_statements
from etb_worker.gpu.backend import GpuBackend
from etb_worker.gpu.budget import budget_alerts
from etb_worker.logs import get_logger
from etb_worker.notify import Notifier
from etb_worker.retention import SWEEP_EVERY, sweep
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError
from etb_worker.tasks import (
    TaskContext,
    account_scrub,
    daily_digest,
    ledger_check,
    lifecycle_rules,
    retention_purge,
    tool_stats,
)

TICK_SEC = 30
# Any constant works; it only has to be the same in every worker.
LOCK_KEY = 0x45544253
NIGHTLY = time(3, 0)
DIGEST_AT = time(9, 0)
RETRY_AFTER = timedelta(minutes=10)
# A tick stops sending alerts once sends that reached nobody have cost it this long (two of
# notify's time-outs) and leaves the rest to the next tick: the reaper, queue expiry and the
# input deletes share its loop. A channel that refuses at once costs nothing, so one alert
# it won't take can't hold back those behind it.
FAILED_SENDS_SEC = 20
SERVICE = "worker"

Task = Callable[[Conn, TaskContext], None]

DAILY: dict[str, tuple[time, Task]] = {
    "ledger_invariant": (NIGHTLY, ledger_check),
    "account_scrub": (NIGHTLY, account_scrub),
    "retention_purge": (NIGHTLY, retention_purge),
    "lifecycle_rules": (NIGHTLY, lifecycle_rules),
    "tool_stats": (NIGHTLY, tool_stats),
    "daily_digest": (DIGEST_AT, daily_digest),
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _log_failure(event: str, error: Exception, **fields: str) -> None:
    """The error's type only: its message may quote a value from a file or a URL."""
    if isinstance(error, psycopg.Error):
        get_logger().warning(
            event, error_code="DB_UNAVAILABLE", detail=type(error).__name__, **fields
        )
    else:
        get_logger().error(event, error_code="INTERNAL", detail=type(error).__name__, **fields)


@dataclass
class Scheduler:
    settings: Settings
    notifier: Notifier
    instance: str = field(default_factory=socket.gethostname)
    connect: Callable[[Settings], Conn] = connect
    clock: Callable[[], datetime] = _utc_now
    disk_path: str = field(default_factory=tempfile.gettempdir)
    # None in tests that don't need it: then there's no sweeping.
    storage: Storage | None = None
    # Cancels GPU calls whose worker died (GPU_BACKEND); None: they're charged to their limit.
    gpu: GpuBackend | None = None
    # Seconds on a clock that never jumps: what a tick's failed sends cost it.
    timer: Callable[[], float] = monotonic
    # A job that raised waits this long before its next try, in this process.
    _retry_at: dict[str, datetime] = field(default_factory=dict)

    def tick(self) -> None:
        """One round. Nothing is raised: a database outage or a bug is logged, and the next
        tick tries again. Each step runs even when one before it failed: a bug in the sweep
        can't stop the reaper, the alerts or the daily jobs, and sweeper_stale reports it."""
        try:
            with self.connect(self.settings) as conn:
                self.beat(conn)
                leader = conn.execute(
                    "select pg_try_advisory_lock(%s) as got", (LOCK_KEY,)
                ).fetchone()
                if not leader or not leader["got"]:
                    return
                try:
                    for name, step in (
                        ("maintain", self.maintain),
                        ("alerts", self.check_alerts),
                        ("daily", self.run_due),
                    ):
                        try:
                            step(conn)
                        except Exception as error:  # noqa: BLE001 - logged; the others still run
                            _log_failure("scheduler.step_failed", error, step=name)
                finally:
                    conn.execute("select pg_advisory_unlock(%s)", (LOCK_KEY,))
        except Exception as error:  # noqa: BLE001 - the loop must outlive any one failure
            _log_failure("scheduler.tick_failed", error)

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

    def maintain(self, conn: Conn) -> None:
        """The queue's upkeep every tick, and the retention sweep every 5 minutes."""
        try:
            reaped = jobqueue.reap(conn)
            for call in reaped.calls:
                self._cancel_call(conn, call)
            jobqueue.expire(conn)
        except (psycopg.errors.LockNotAvailable, psycopg.errors.QueryCanceled) as error:
            # The connection's limits (db.py): a job or user row someone else holds, or a
            # statement out of time. That upkeep waits for the next tick. The deletes below
            # don't wait with it: they keep a person's files from outliving their job.
            _log_failure("scheduler.step_failed", error, step="queue")
        self._drop_inputs(conn)
        if self.storage is None:
            return
        row = conn.execute(
            "select ran_at from system_checks where name = 'retention_sweeper'"
        ).fetchone()
        if row is not None and self.clock() - row["ran_at"] < SWEEP_EVERY:
            return
        try:
            _counts, alerts = sweep(conn, self.storage)
        except StorageError as error:
            # No record: the sweeper_stale rule alerts if this lasts 30 minutes.
            get_logger().warning("retention.sweep_failed", error_code=error.code)
            return
        for alert in alerts:
            raise_alert(conn, alert, self.notifier)

    def _cancel_call(self, conn: Conn, call: jobqueue.StaleCall) -> None:
        """A GPU call a dead worker left running: cancel it; alert if it can't be."""
        cancel = self.gpu.cancel if self.gpu is not None else None
        if jobqueue.cancel_stale_call(conn, cancel, call):
            return
        minutes = max(1, round(call.remaining_sec / 60))
        alert = Alert(
            "gpu_call_not_cancelled",
            str(call.call_id),
            f"A GPU call left by a worker that stopped couldn't be cancelled on Modal "
            f"({call.call_id}). It may run up to {minutes} more min; that time is counted "
            "against today's GPU budget. Stop it in Modal's dashboard (Apps, edittoolbelt-gpu).",
            immediate=True,
        )
        raise_alert(conn, alert, self.notifier)

    def _drop_inputs(self, conn: Conn) -> None:
        """Ended jobs that still hold an input, with no runner left to delete it, lose it now.

        Those the steps above just ended (reaped for good, expired), and those
        an earlier tick or a runner left behind: cancelled while its worker
        was dead, or the worker killed between marking a job and deleting its
        input. They are read from the rows every tick, not handed on in
        memory, so an error or a kill at any point only delays the delete to
        the next tick. The first delete storage refuses ends the pass: storage
        is down, and a timeout for every job would hold up the heartbeat and
        the reaper, which share this loop.
        """
        if self.storage is None:
            return
        for job_id in jobqueue.ended_with_inputs(conn):
            if not self._drop_input(conn, self.storage, job_id):
                return

    def _drop_input(self, conn: Conn, storage: Storage, job_id: str) -> bool:
        """Deletes one ended job's inputs; False as soon as storage refuses one.

        Those that went are recorded; the rest stay on the job, for the next tick.
        The job's row is locked meanwhile, so nobody queues it again half-way.
        """
        log = get_logger(job_id=job_id)
        with conn.transaction():
            job = jobqueue.lock_ended(conn, job_id)
            if job is None:
                # Queued again since it was read (an admin's retry): it needs its inputs.
                # Or its row is held just now: the next tick finds it again.
                return True
            keys = jobqueue.input_keys(job)
            gone = []
            for key in keys:
                try:
                    storage.delete(key)
                except StorageError as error:
                    log.warning("retention.input_not_deleted", error_code=error.code)
                    break
                gone.append(key)
            jobqueue.input_gone(conn, job, gone)
        if gone:
            log.info("retention.input_deleted", inputs=len(gone))
        return len(gone) == len(keys)

    def check_alerts(self, conn: Conn) -> None:
        log = get_logger()
        found: list[Alert] = []
        for name, rule in (*DATABASE_RULES, ("gpu_budget", budget_alerts)):
            try:
                found += rule(conn)
            except psycopg.Error as error:
                log.warning("alert.rule_failed", rule=name, detail=type(error).__name__)
        try:
            found += disk_space(self.disk_path, self.instance)
        except OSError as error:
            log.warning("alert.rule_failed", rule="disk", detail=type(error).__name__)
        # An alert no channel delivered is found again on every tick, and a channel that is
        # down may take its whole time-out to say so, once for each of them.
        failed_sec = 0.0
        for at, alert in enumerate(in_turn(conn, found)):
            if failed_sec >= FAILED_SENDS_SEC:
                log.warning("alert.sends_put_off", alerts=len(found) - at)
                break
            started = self.timer()
            if not raise_alert(conn, alert, self.notifier):
                # Nobody was told. (Or it is cooling down, which took one query: no time.)
                failed_sec += self.timer() - started

    def run_due(self, conn: Conn) -> None:
        now = self.clock()
        rows = conn.execute("select name, ran_at, ok from system_checks").fetchall()
        last = {row["name"]: row["ran_at"] for row in rows}
        not_ok = {row["name"] for row in rows if not row["ok"]}
        for name, (at, _task) in DAILY.items():
            if self._retry_at.get(name, now) > now:
                continue
            due = is_daily_due(last.get(name), now, at)
            # A digest no channel delivered is recorded as not ok (tasks.daily_digest) and is
            # still owed: it goes out again every 10 minutes until one does.
            if name == "daily_digest" and name in not_ok and now - last[name] >= RETRY_AFTER:
                due = True
            if due:
                self.run(conn, name)

    def run(self, conn: Conn, name: str) -> bool:
        """Runs one daily job now. A job that fails alerts and is retried in 10 minutes."""
        _at, task = DAILY[name]
        log = get_logger(task=name)
        now = self.clock()
        try:
            # These read whole tables (the ledger check sums every ledger row), so a
            # statement gets longer here than anywhere else in the tick.
            with long_statements(conn):
                task(conn, TaskContext(notifier=self.notifier, now=now, storage=self.storage))
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

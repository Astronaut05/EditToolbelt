"""The scheduler loop outlives any one failure (the DB tests cover what each step does).

The heartbeat, the reaper and the retention sweeper all live in this loop:
if it stopped, nothing inside the worker would notice (final worker review, S1).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any, cast

import psycopg
import pytest

from etb_worker.db import Conn
from etb_worker.main import run_scheduler
from etb_worker.notify import Notifier
from etb_worker.scheduler import Scheduler
from etb_worker.settings import Settings

Lines = Callable[[], list[dict[str, Any]]]


class FakeConn:
    """A connection that records its queries; this worker always gets the leader lock."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def __enter__(self) -> FakeConn:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, query: str, _params: object = None) -> FakeConn:
        self.queries.append(" ".join(query.split()))
        return self

    def fetchone(self) -> dict[str, Any]:
        return {"got": True}


def scheduler(settings: Settings, conn: FakeConn) -> Scheduler:
    return Scheduler(settings, Notifier(settings), connect=lambda _: cast(Conn, conn))


def test_a_failing_step_is_logged_and_the_others_still_run(
    settings: Settings, log_lines: Lines, monkeypatch: pytest.MonkeyPatch
) -> None:
    conn = FakeConn()
    sched = scheduler(settings, conn)
    ran: list[str] = []

    def broken(_conn: Conn) -> None:
        ran.append("maintain")
        raise KeyError("in/0f9e-a-key-from-a-listing")

    monkeypatch.setattr(sched, "maintain", broken)
    monkeypatch.setattr(sched, "check_alerts", lambda _conn: ran.append("alerts"))
    monkeypatch.setattr(sched, "run_due", lambda _conn: ran.append("daily"))

    sched.tick()
    sched.tick()

    assert ran == ["maintain", "alerts", "daily"] * 2
    # The leader lock is given back every time.
    assert sum("pg_advisory_unlock" in query for query in conn.queries) == 2
    failed = [line for line in log_lines() if line["event"] == "scheduler.step_failed"]
    assert len(failed) == 2
    assert failed[0]["step"] == "maintain"
    assert (failed[0]["error_code"], failed[0]["detail"]) == ("INTERNAL", "KeyError")
    assert failed[0]["level"] == "error"
    # Only the error's type: its message may name a key or quote a file's metadata.
    assert "a-key-from-a-listing" not in str(log_lines())


def test_a_tick_that_cant_start_is_logged_never_raised(
    settings: Settings, log_lines: Lines
) -> None:
    def no_database(_: Settings) -> Conn:
        raise psycopg.OperationalError("connection refused")

    def a_bug(_: Settings) -> Conn:
        raise RuntimeError("unexpected")

    Scheduler(settings, Notifier(settings), connect=no_database).tick()
    Scheduler(settings, Notifier(settings), connect=a_bug).tick()
    failed = [line for line in log_lines() if line["event"] == "scheduler.tick_failed"]
    assert [(line["level"], line["error_code"], line["detail"]) for line in failed] == [
        ("warn", "DB_UNAVAILABLE", "OperationalError"),
        ("error", "INTERNAL", "RuntimeError"),
    ]


def test_the_loop_goes_on_after_a_tick_raises(log_lines: Lines) -> None:
    stop = threading.Event()

    class Ticker:
        calls = 0

        def tick(self) -> None:
            self.calls += 1
            if self.calls == 1:
                raise KeyError("Initiated")  # e.g. a storage listing without a field we read
            if self.calls == 3:
                stop.set()

    ticker = Ticker()
    run_scheduler(cast(Scheduler, ticker), stop, every=0)
    assert ticker.calls == 3
    [crashed] = [line for line in log_lines() if line["event"] == "scheduler.tick_crashed"]
    assert (crashed["error_code"], crashed["detail"]) == ("INTERNAL", "KeyError")

"""Worker entry point: ``python -m etb_worker`` (or ``etb-worker``).

Validate env, configure logging, run the hello-world job (retrying while
Postgres and storage start up), then run the scheduler until SIGTERM/SIGINT:
heartbeats, alert rules and the daily jobs (scheduler.py). M4 adds the job
queue beside it. ``--task NAME`` runs one daily job now and exits.
"""

from __future__ import annotations

import argparse
import os
import signal
import threading
from collections.abc import Callable, Sequence

from etb_worker.db import connect
from etb_worker.hello import HelloResult, run_hello
from etb_worker.logs import configure_logging, get_logger
from etb_worker.notify import Notifier
from etb_worker.scheduler import DAILY, TICK_SEC, Scheduler
from etb_worker.settings import Settings, load_settings

RETRY_DELAYS_SEC = (1, 2, 4, 8, 15)


def run_hello_with_retries(
    settings: Settings,
    *,
    hello: Callable[[Settings], HelloResult] = run_hello,
    wait: Callable[[float], bool] | None = None,
) -> bool:
    """Run the hello job, retrying on failure. ``wait`` returns True if we should stop early."""
    log = get_logger()
    stop = threading.Event()
    wait = wait or stop.wait
    attempt = 0
    for delay in (*RETRY_DELAYS_SEC, None):
        attempt += 1
        result = hello(settings)
        if result.ok:
            return True
        if delay is None:
            break
        log.warning(
            "hello.retry", attempt=attempt, error_code=result.error_code, retry_in_sec=delay
        )
        if wait(delay):
            break
    log.error("hello.gave_up", attempts=attempt)
    return False


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="etb-worker")
    parser.add_argument(
        "--once", action="store_true", help="exit after the hello job instead of scheduling"
    )
    parser.add_argument("--task", choices=sorted(DAILY), help="run one daily job now, then exit")
    args = parser.parse_args(argv)

    settings = load_settings()
    configure_logging(
        service="worker",
        env=settings.app_env,
        version=settings.app_version,
        level=settings.log_level,
    )
    log = get_logger()
    log.info("worker.started", pid=os.getpid())

    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        log.info("worker.stopping", signal=signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    scheduler = Scheduler(settings, Notifier(settings))
    if args.task:
        with connect(settings) as conn:
            return 0 if scheduler.run(conn, args.task) else 1

    ok = run_hello_with_retries(settings, wait=stop.wait)
    if not ok:
        return 1
    if args.once:
        return 0

    log.info(
        "scheduler.started",
        tick_sec=TICK_SEC,
        telegram=settings.telegram_enabled,
        email=settings.email_enabled,
    )
    while not stop.is_set():
        scheduler.tick()
        stop.wait(TICK_SEC)
    scheduler.leave()
    log.info("worker.stopped")
    return 0

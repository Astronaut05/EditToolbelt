"""Worker entry point: ``python -m etb_worker`` (or ``etb-worker``).

M0: validate env, configure logging, run the hello-world job (retrying while
Postgres and storage start up), then idle until SIGTERM/SIGINT. The job queue
loop replaces the idle wait in M4.
"""

from __future__ import annotations

import argparse
import os
import signal
import threading
from collections.abc import Callable, Sequence

from etb_worker.hello import HelloResult, run_hello
from etb_worker.logs import configure_logging, get_logger
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
        "--once", action="store_true", help="exit after the hello job instead of idling"
    )
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

    ok = run_hello_with_retries(settings, wait=stop.wait)
    if not ok:
        return 1
    if args.once:
        return 0

    log.info("worker.idle", detail="no job queue yet (arrives in M4)")
    stop.wait()
    log.info("worker.stopped")
    return 0

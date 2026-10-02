"""Worker entry point: ``python -m etb_worker`` (or ``etb-worker``).

Validate env, configure logging, run the hello-world job (retrying while
Postgres and storage start up), then until SIGTERM/SIGINT run the job slots
(slots.py: probe uploads, run jobs) beside the scheduler (scheduler.py:
heartbeats, queue upkeep, the retention sweep, alerts, the daily jobs).
``--task NAME`` runs one daily job now and exits.
"""

from __future__ import annotations

import argparse
import os
import signal
import threading
from collections.abc import Callable, Sequence

from etb_worker.db import connect
from etb_worker.gpu.backend import make_backend
from etb_worker.hello import HelloResult, run_hello
from etb_worker.logs import configure_logging, get_logger
from etb_worker.notify import Notifier
from etb_worker.runner import JobRunner
from etb_worker.scheduler import DAILY, TICK_SEC, Scheduler
from etb_worker.settings import Settings, load_settings
from etb_worker.slots import listen, run_slot
from etb_worker.storage import Storage

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

    storage = Storage(settings)
    scheduler = Scheduler(settings, Notifier(settings), storage=storage)
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
    wake = threading.Event()
    threading.Thread(target=listen, args=(settings, wake, stop), daemon=True).start()
    gpu = make_backend(settings)
    if settings.gpu_backend and gpu is None:
        log.error("gpu.off", error_code="GPU_NOT_CONFIGURED", backend=settings.gpu_backend)
    else:
        log.info("gpu.backend", backend=gpu.name if gpu else "off")
    runners = [
        JobRunner(storage, lambda: connect(settings), gpu=gpu) for _ in range(settings.worker_slots)
    ]
    slots = [
        threading.Thread(target=run_slot, args=(settings, storage, runner, wake, stop))
        for runner in runners
    ]
    for slot in slots:
        slot.start()
    log.info("slots.started", slots=len(slots))
    while not stop.is_set():
        scheduler.tick()
        stop.wait(TICK_SEC)
    # A clean stop hands running jobs back to the queue at once.
    for runner in runners:
        runner.stop_current()
    wake.set()
    for slot in slots:
        slot.join(timeout=20)
    scheduler.leave()
    log.info("worker.stopped")
    return 0

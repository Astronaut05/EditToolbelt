"""The worker's job slots (docs/01 -> Queue, Workers).

Two kinds, each a thread running one job at a time:

- **CPU slots** (WORKER_SLOTS) probe new uploads and run CPU jobs; the work
  itself happens in ffmpeg processes, so threads are enough.
- **GPU slots** (WORKER_GPU_SLOTS) run only GPU jobs. Each mostly waits on a
  call on Modal, for up to an hour, so they never probe and never take a CPU
  job: a burst of transcriptions can't stall probing or the CPU tools.

A listener wakes idle slots on ``NOTIFY etb_jobs`` / ``etb_uploads``; they
also poll every 2 s in case a notification is missed.
"""

from __future__ import annotations

import threading

import psycopg

from etb_worker.db import connect
from etb_worker.logs import get_logger
from etb_worker.probe import probe_next
from etb_worker.runner import JobRunner
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError

POLL_SEC = 2
CHANNELS = ("etb_jobs", "etb_uploads")


def listen(settings: Settings, wake: threading.Event, stop: threading.Event) -> None:
    """Sets ``wake`` on every notification until ``stop``; reconnects when the database drops."""
    while not stop.is_set():
        try:
            with connect(settings) as conn:
                for channel in CHANNELS:
                    conn.execute(f"listen {channel}")
                while not stop.is_set():
                    for _ in conn.notifies(timeout=5):
                        wake.set()
        except psycopg.Error:
            stop.wait(5)


def run_slot(
    settings: Settings,
    storage: Storage,
    runner: JobRunner,
    wake: threading.Event,
    stop: threading.Event,
) -> None:
    log = get_logger()
    while not stop.is_set():
        worked = False
        try:
            with connect(settings) as conn:
                worked = probe_next(conn, storage)
            if not stop.is_set():
                worked = runner.run_next() or worked
        except psycopg.Error as error:
            log.warning("slot.db_unavailable", detail=type(error).__name__)
            stop.wait(5)
            continue
        except StorageError as error:
            log.warning("slot.storage_unavailable", error_code=error.code)
            stop.wait(5)
            continue
        if not worked:
            wake.wait(POLL_SEC)
            wake.clear()


def run_gpu_slot(runner: JobRunner, wake: threading.Event, stop: threading.Event) -> None:
    """A GPU slot: runs GPU jobs only (``runner.pool == "gpu"``), never probes."""
    log = get_logger()
    while not stop.is_set():
        try:
            worked = runner.run_next()
        except psycopg.Error as error:
            log.warning("slot.db_unavailable", detail=type(error).__name__, pool="gpu")
            stop.wait(5)
            continue
        except StorageError as error:
            log.warning("slot.storage_unavailable", error_code=error.code, pool="gpu")
            stop.wait(5)
            continue
        if not worked:
            wake.wait(POLL_SEC)
            wake.clear()

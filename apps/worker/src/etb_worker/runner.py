"""Running one job end to end (docs/01 -> Workers, Retention).

Claim → download the input into a per-job temp dir → run the processor
(the sandbox, progress reported through a heartbeat every 5 s) → upload the
output under a random key → mark the job. Whatever happens, the ``finally``
deletes the temp dir and the input object: inputs live exactly as long as
their job. Only a worker that dies mid-job leaves the input, so the reaper
can hand the job to another worker.
"""

from __future__ import annotations

import shutil
import socket
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg

from etb_worker import jobqueue
from etb_worker.db import Conn
from etb_worker.logs import get_logger
from etb_worker.processors import PROCESSORS, JobContext, JobFailed, Processor
from etb_worker.sandbox import Limits, ToolError
from etb_worker.storage import Storage, StorageError


@dataclass
class _Progress:
    pct: int = 0
    stage: str = "starting"
    lock: threading.Lock = field(default_factory=threading.Lock)

    def set(self, pct: int, stage: str) -> None:
        with self.lock:
            self.pct, self.stage = pct, stage

    def get(self) -> tuple[int, str]:
        with self.lock:
            return self.pct, self.stage


class _Heartbeat(threading.Thread):
    """Writes progress every 5 s; sets ``cancel`` when the job is no longer ours."""

    def __init__(
        self, runner: JobRunner, job_id: str, progress: _Progress, cancel: threading.Event
    ) -> None:
        super().__init__(daemon=True)
        self._runner, self._job_id = runner, job_id
        self._progress, self._cancel = progress, cancel
        self._stop = threading.Event()

    def run(self) -> None:
        runner = self._runner
        while not self._stop.wait(runner.heartbeat_sec):
            pct, stage = self._progress.get()
            try:
                with runner.connect() as conn:
                    ours = jobqueue.heartbeat(conn, self._job_id, runner.worker_id, pct, stage)
            except psycopg.Error:
                continue  # the database blinked; the reaper allows 60 s
            if not ours:
                self._cancel.set()
                return

    def stop(self) -> None:
        self._stop.set()


class JobRunner:
    """One job slot: claims and runs jobs one at a time."""

    def __init__(
        self,
        storage: Storage,
        connect: Callable[[], Conn],
        *,
        processors: dict[str, Processor] | None = None,
        worker_id: str | None = None,
        heartbeat_sec: float = jobqueue.HEARTBEAT_SEC,
    ) -> None:
        self.storage = storage
        self.connect = connect
        self.processors = PROCESSORS if processors is None else processors
        self.worker_id = worker_id or f"{socket.gethostname()}:{threading.get_ident()}"
        self.heartbeat_sec = heartbeat_sec
        self.stopping = threading.Event()
        self._current: threading.Event | None = None

    def run_next(self) -> bool:
        """Claims and runs one job; False when the queue is empty."""
        with self.connect() as conn:
            job = jobqueue.claim(conn, self.worker_id)
        if job is None:
            return False
        self.run(job)
        return True

    def stop_current(self) -> None:
        """For a clean shutdown: stop the running tool; the job goes back to the queue."""
        self.stopping.set()
        if self._current is not None:
            self._current.set()

    def run(self, job: jobqueue.Job) -> None:
        job_id = str(job["id"])
        log = get_logger(job_id=job_id, tool_id=job["tool_id"])
        log.info("job.started", attempt=job["attempts"])
        workdir = Path(tempfile.mkdtemp(prefix="etb-job-"))
        cancel = threading.Event()
        self._current = cancel
        progress = _Progress()
        beat = _Heartbeat(self, job_id, progress, cancel)
        beat.start()
        requeued = False
        try:
            output_key, output_meta = self._process(job, workdir, cancel, progress)
            with self.connect() as conn:
                done = jobqueue.succeed(conn, job, self.worker_id, output_key, output_meta)
            if done:
                log.info("job.succeeded", bytes=output_meta.get("bytes"))
            else:
                self.storage.delete(output_key)  # cancelled while uploading
                log.info("job.cancelled")
        except (JobFailed, ToolError, StorageError) as error:
            if isinstance(error, ToolError) and error.code == "CANCELLED":
                if self.stopping.is_set():
                    with self.connect() as conn:
                        jobqueue.requeue(conn, job_id, self.worker_id)
                    requeued = True
                    log.info("job.handed_back")
                else:
                    log.info("job.cancelled")
            else:
                code = error.code if not isinstance(error, StorageError) else "STORAGE_UNAVAILABLE"
                self._fail(job, code, str(error))
        except Exception as error:  # a bug fails the job, never the worker
            log.exception("job.crashed", error_code="INTERNAL")
            self._fail(job, "INTERNAL", type(error).__name__)
        finally:
            beat.stop()
            self._current = None
            shutil.rmtree(workdir, ignore_errors=True)
            if not requeued:
                self._delete_input(job)

    def _process(
        self, job: jobqueue.Job, workdir: Path, cancel: threading.Event, progress: _Progress
    ) -> tuple[str, dict[str, Any]]:
        processor = self.processors.get(job["tool_id"])
        if processor is None:
            raise JobFailed("TOOL_UNAVAILABLE", "this tool doesn't run on this worker")
        if not job.get("input_key"):
            raise JobFailed("NOT_FOUND", "the input is gone")
        input_path = workdir / "input"
        progress.set(0, "downloading")
        self.storage.download(str(job["input_key"]), input_path)
        extras = []
        for index, key in enumerate(job.get("extra_input_keys") or []):
            extras.append(workdir / f"extra-{index}")
            self.storage.download(str(key), extras[-1])
        ctx = JobContext(
            job_id=str(job["id"]),
            tool_id=str(job["tool_id"]),
            input_path=input_path,
            workdir=workdir,
            options=dict(job.get("options") or {}),
            meta=dict(job.get("input_meta") or {}),
            limits=Limits(timeout_sec=float(job.get("timeout_sec") or 900)),
            cancel=cancel,
            progress=progress.set,
            extra_paths=extras,
        )
        progress.set(0, "processing")
        output = processor.run(ctx)
        if cancel.is_set():
            raise ToolError("CANCELLED", "cancelled")
        progress.set(99, "uploading")
        size = output.path.stat().st_size
        key = self.storage.upload(output.path, output.content_type)
        meta = {
            **output.meta,
            "bytes": size,
            "content_type": output.content_type,
            "ext": output.ext,
        }
        return key, meta

    def _fail(self, job: jobqueue.Job, code: str, detail: str) -> None:
        log = get_logger(job_id=str(job["id"]), tool_id=job["tool_id"])
        try:
            with self.connect() as conn:
                jobqueue.fail(conn, job, self.worker_id, code, detail)
        except psycopg.Error:
            log.exception("job.fail_not_recorded", error_code=code)
            return
        log.warning("job.failed", error_code=code)

    def _delete_input(self, job: jobqueue.Job) -> None:
        """Every input goes, each tried even when one fails (Merge Videos has up to 20)."""
        keys = jobqueue.input_keys(job)
        if not keys:
            return
        gone = []
        for key in keys:
            try:
                self.storage.delete(key)
            except StorageError as error:
                # The sweeper removes it within the hour; say so loudly.
                get_logger(job_id=str(job["id"])).warning(
                    "job.input_not_deleted", error_code=error.code
                )
                continue
            gone.append(key)
        try:
            with self.connect() as conn:
                jobqueue.input_gone(conn, job, gone)
        except psycopg.Error:
            get_logger(job_id=str(job["id"])).exception("job.input_not_recorded")

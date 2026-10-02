"""Running one job end to end (docs/01 -> Workers, Retention).

Claim → download the input into a per-job temp dir → run the processor
(the sandbox, progress reported through a heartbeat every 5 s) → put a new
random key on the job, then upload the output under it (so it's found and
deleted even if this worker dies before the next step) → mark the job.
Whatever happens, the ``finally``
deletes the temp dir and the input object: inputs live exactly as long as
their job. Only a worker that dies mid-job leaves the input, so the reaper
can hand the job to another worker.

GPU jobs (remote processors) skip the download and upload: the GPU function
reads the input and writes the output through presigned URLs. They run in
their own slots (``pool="gpu"``, WORKER_GPU_SLOTS), which claim only GPU
jobs, so a call waiting on Modal never holds up probing or the CPU tools;
CPU slots claim only CPU jobs. A GPU call's time goes on the job as it ends,
and GPU claims stop while today's GPU budget is spent (gpu/budget.py).
"""

from __future__ import annotations

import shutil
import socket
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import psycopg

from etb_worker import jobqueue
from etb_worker.db import Conn
from etb_worker.gpu.backend import GpuBackend
from etb_worker.logs import get_logger
from etb_worker.processors import (
    PROCESSORS,
    GpuUsage,
    JobContext,
    JobFailed,
    Output,
    Processor,
    is_remote,
)
from etb_worker.sandbox import Limits, ToolError
from etb_worker.storage import Storage, StorageError, new_output_key


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
    """One job slot: claims and runs jobs of its pool, CPU or GPU, one at a time."""

    def __init__(  # noqa: PLR0913 - keyword-only after the two it always needs
        self,
        storage: Storage,
        connect: Callable[[], Conn],
        *,
        processors: dict[str, Processor] | None = None,
        worker_id: str | None = None,
        heartbeat_sec: float = jobqueue.HEARTBEAT_SEC,
        gpu: GpuBackend | None = None,
        pool: Literal["cpu", "gpu"] = "cpu",
    ) -> None:
        self.storage = storage
        self.connect = connect
        self.processors = PROCESSORS if processors is None else processors
        #: GPU_BACKEND's backend; None: GPU jobs fail at once with their credits back.
        self.gpu = gpu
        #: Which jobs this slot claims: CPU jobs, or GPU jobs (under the daily budget).
        self.pool = pool
        self.worker_id = worker_id or f"{socket.gethostname()}:{threading.get_ident()}"
        self.heartbeat_sec = heartbeat_sec
        self.stopping = threading.Event()
        self._current: threading.Event | None = None

    def run_next(self) -> bool:
        """Claims and runs one job of this slot's pool; False when there's none to start."""
        with self.connect() as conn:
            if self.pool == "gpu":
                job = jobqueue.claim_gpu(conn, self.worker_id)
            else:
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
            self._settle_stale_call(job)
            self._drop_stale_output(job)
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
        remote = is_remote(processor)
        extras = []
        if not remote:
            progress.set(0, "downloading")
            self.storage.download(str(job["input_key"]), input_path)
            for index, key in enumerate(job.get("extra_input_keys") or []):
                extras.append(workdir / f"extra-{index}")
                self.storage.download(str(key), extras[-1])
        job_id = str(job["id"])
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
            input_key=str(job["input_key"]),
            storage=self.storage if remote else None,
            gpu=self.gpu if remote else None,
            record_gpu=lambda usage: self._record_gpu(job_id, usage),
            start_call=lambda key, expires: self._start_call(job_id, key, expires),
            call_spawned=lambda call_id: self._call_spawned(job_id, call_id),
            extra_input_keys=[str(key) for key in job.get("extra_input_keys") or []]
            if remote
            else [],
        )
        progress.set(0, "processing")
        output = processor.run(ctx)
        if cancel.is_set():
            if output.key:
                self.storage.delete(output.key)
            raise ToolError("CANCELLED", "cancelled")
        key, size = self._store(job_id, output, progress)
        meta = {
            **output.meta,
            "bytes": size,
            "content_type": output.content_type,
            "ext": output.ext,
        }
        return key, meta

    def _store(self, job_id: str, output: Output, progress: _Progress) -> tuple[str, int]:
        """The output's key and size: stored already by a GPU function, or uploaded now.

        An upload's key goes on the job first, so the file can always be found
        and deleted, even if this worker dies before the job is marked done.
        """
        if output.key is not None:
            return output.key, int(output.bytes or 0)
        if output.path is None:
            raise JobFailed("INTERNAL", "the tool made no output")
        key = new_output_key()
        with self.connect() as conn:
            if not jobqueue.record_output(conn, job_id, self.worker_id, key):
                raise ToolError("CANCELLED", "cancelled")  # cancelled or reaped: upload nothing
        progress.set(99, "uploading")
        size = output.path.stat().st_size
        return self.storage.upload(output.path, output.content_type, key), size

    def _record_gpu(self, job_id: str, usage: GpuUsage) -> None:
        log = get_logger(job_id=job_id)
        try:
            with self.connect() as conn:
                recorded = jobqueue.record_gpu(
                    conn, job_id, self.worker_id, usage.gpu_seconds, usage.billed_seconds
                )
        except psycopg.Error:
            # Left in flight on the job: the reaper (or the next attempt) settles it later.
            log.exception("job.gpu_not_recorded", gpu_seconds=round(usage.gpu_seconds, 1))
            return
        if not recorded:
            log.info("job.gpu_settled_elsewhere", gpu_seconds=round(usage.gpu_seconds, 1))
            return
        log.info("job.gpu_used", gpu_seconds=round(usage.gpu_seconds, 1))

    def _start_call(self, job_id: str, key: str, expires_sec: int) -> bool:
        with self.connect() as conn:
            return jobqueue.start_gpu_call(conn, job_id, self.worker_id, key, expires_sec)

    def _call_spawned(self, job_id: str, call_id: str) -> None:
        try:
            with self.connect() as conn:
                jobqueue.gpu_call_spawned(conn, job_id, self.worker_id, call_id)
        except psycopg.Error:
            # If this worker now dies, its call runs on to its timeout: say so loudly.
            get_logger(job_id=job_id).exception("job.gpu_call_id_not_recorded")

    def _settle_stale_call(self, job: jobqueue.Job) -> None:
        """A call an earlier attempt left in flight and nobody settled: record it, cancel it."""
        if job.get("gpu_call_at") is None:
            return
        with self.connect() as conn:
            with conn.transaction():
                stale = jobqueue.settle_call(conn, str(job["id"]))
            if stale is not None:
                cancel = self.gpu.cancel if self.gpu is not None else None
                jobqueue.cancel_stale_call(conn, cancel, stale)

    def _drop_stale_output(self, job: jobqueue.Job) -> None:
        """A key an earlier attempt's GPU call wrote to (that worker died): delete it first."""
        stale = job.get("output_key")
        if not stale:
            return
        self.storage.delete(str(stale))
        with self.connect() as conn:
            conn.execute(
                "update jobs set output_key = null where id = %s and output_key = %s",
                (job["id"], stale),
            )

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

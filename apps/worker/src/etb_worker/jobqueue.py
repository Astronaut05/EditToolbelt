"""The job queue: the ``jobs`` table (docs/01 -> Queue).

- Claim: the highest-priority, oldest queued job whose tool is under its
  concurrency cap, with ``FOR UPDATE SKIP LOCKED`` so workers never collide.
  CPU jobs and GPU jobs (those with a GPU rate) are claimed apart, by
  different slots, so a GPU call that waits on Modal for an hour never holds
  a slot that probes uploads and runs ffmpeg. GPU claims go one at a time
  under an advisory lock, with the daily budget checked in the same
  transaction (gpu/budget.py).
- Heartbeat every 5 s while running; it also notices a cancel.
- Reaper: a running job silent for 60 s goes back to the queue, at most
  twice; the third time it fails and its credits come back. A GPU call its
  dead worker left running is settled (its time so far goes on the job as
  cost) and handed back to be cancelled.
- Expiry: a job queued for 15 min is expired and its credits come back.

Every status change and its ledger row happen in one transaction.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from psycopg.types.json import Jsonb

from etb_worker.db import Conn
from etb_worker.gpu import MAX_IDLE_TAIL_SEC
from etb_worker.gpu.budget import CLAIM_LOCK, gpu_open
from etb_worker.ledger import capture, release
from etb_worker.logs import get_logger

HEARTBEAT_SEC = 5
STALE_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 3  # the first run and 2 retries
QUEUE_EXPIRY = timedelta(minutes=15)

Job = dict[str, Any]


_CLAIM = """
    with next as (
      select j.id from jobs j
      where j.status = 'queued'
        and (j.gpu_rate_usd is not null) = %s
        and (j.max_concurrent is null or (
          select count(*) from jobs r
          where r.status = 'running' and r.tool_id = j.tool_id
        ) < j.max_concurrent)
      order by j.priority desc, j.created_at
      limit 1
      for update skip locked
    )
    update jobs
    set status = 'running', started_at = now(), heartbeat_at = now(),
        attempts = jobs.attempts + 1, worker_id = %s, progress = 0,
        stage = 'starting', updated_at = now()
    from next
    where jobs.id = next.id
    returning jobs.*
"""


def claim(conn: Conn, worker_id: str) -> Job | None:
    """Takes the next CPU job off the queue, or None. GPU jobs are claim_gpu's."""
    with conn.transaction():
        return conn.execute(_CLAIM, (False, worker_id)).fetchone()


def claim_gpu(conn: Conn, worker_id: str) -> Job | None:
    """Takes the next GPU job off the queue, or None (none queued, or no budget left).

    One claimer at a time, across every slot and worker: the advisory lock is
    held to the end of the transaction, so the next claimer's budget check
    sees this job running, at its worst case (gpu/budget.py). While the
    budget is spent GPU jobs wait; if they wait 15 minutes they expire and
    their credits come back.
    """
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(%s)", (CLAIM_LOCK,))
        if not gpu_open(conn):
            return None
        return conn.execute(_CLAIM, (True, worker_id)).fetchone()


def heartbeat(conn: Conn, job_id: str, worker_id: str, progress: int, stage: str) -> bool:
    """Records progress; False when the job is no longer ours to run (cancelled, reaped)."""
    row = conn.execute(
        """
        update jobs set heartbeat_at = now(), progress = %s, stage = %s, updated_at = now()
        where id = %s and worker_id = %s and status = 'running'
        returning id
        """,
        (max(0, min(100, progress)), stage[:40], job_id, worker_id),
    ).fetchone()
    return row is not None


def record_gpu(
    conn: Conn, job_id: str, worker_id: str, gpu_seconds: float, billed_seconds: float
) -> bool:
    """Adds the GPU call's time to the job, and its cost at the rate the job was created with.

    Whatever became of the job (a cancelled call still ran): this is what the
    daily budget and the admin's costs add up. The call is then no longer in
    flight. False when someone else settled it already: this worker was
    thought dead, and the reaper recorded the call's time and cancelled it.
    """
    row = conn.execute(
        """
        update jobs
        set gpu_seconds = coalesce(gpu_seconds, 0) + %s,
            gpu_cost_usd = coalesce(gpu_cost_usd, 0) + %s * coalesce(gpu_rate_usd, 0),
            gpu_call_at = null, gpu_call_id = null, updated_at = now()
        where id = %s and worker_id = %s and gpu_call_at is not null
        returning id
        """,
        (round(gpu_seconds, 3), round(billed_seconds, 3), job_id, worker_id),
    ).fetchone()
    return row is not None


def start_gpu_call(conn: Conn, job_id: str, worker_id: str, key: str, expires_sec: int) -> bool:
    """Records a GPU call about to start, before its URLs leave the worker.

    The output key it may write to becomes the job's output (found and swept
    if this worker dies) and joins the job's GPU keys, which the sweeper
    keeps deleting until the URL's expiry has passed (retention.py). False
    when the job is no longer ours to run: then nothing may be started.
    """
    row = conn.execute(
        """
        update jobs
        set output_key = %(key)s,
            gpu_output_keys = array_append(gpu_output_keys, %(key)s),
            gpu_put_expires_at = greatest(
              gpu_put_expires_at, now() + make_interval(secs => %(expires)s)),
            gpu_call_at = now(), gpu_call_id = null, updated_at = now()
        where id = %(job)s and worker_id = %(worker)s and status = 'running'
        returning id
        """,
        {"key": key, "expires": expires_sec, "job": job_id, "worker": worker_id},
    ).fetchone()
    return row is not None


def gpu_call_spawned(conn: Conn, job_id: str, worker_id: str, call_id: str) -> None:
    """The backend's id for the call, so it can be cancelled if this worker dies."""
    conn.execute(
        """
        update jobs set gpu_call_id = %s, updated_at = now()
        where id = %s and worker_id = %s and gpu_call_at is not null
        """,
        (call_id, job_id, worker_id),
    )


@dataclass(frozen=True)
class StaleCall:
    """A GPU call whose worker is gone, settled at its time so far; it still has to be cancelled."""

    job_id: str
    call_id: str | None
    elapsed_sec: float
    #: What's left of the job's time limit: as long as a call that can't be cancelled may run on.
    remaining_sec: float


def settle_call(conn: Conn, job_id: str) -> StaleCall | None:
    """The job's call in flight, left by a worker that's gone: settled, or None if there's none.

    Its wall-clock time since it started, plus the longest idle window, goes
    on the job as GPU time and cost (an upper bound: it includes any wait on
    Modal), so the budget sees it; then the call is forgotten. The caller
    cancels it by the returned id (cancel_stale_call).
    """
    row = conn.execute(
        """
        with stale as (
          select id, gpu_call_id,
                 greatest(extract(epoch from now() - gpu_call_at), 0)::float8 as elapsed
          from jobs
          where id = %(job)s and gpu_call_at is not null
          for update
        )
        update jobs j
        set gpu_seconds = coalesce(j.gpu_seconds, 0) + round(stale.elapsed::numeric, 3),
            gpu_cost_usd = coalesce(j.gpu_cost_usd, 0)
              + round((stale.elapsed + %(tail)s)::numeric, 3) * coalesce(j.gpu_rate_usd, 0),
            gpu_call_at = null, gpu_call_id = null, updated_at = now()
        from stale
        where j.id = stale.id
        returning stale.gpu_call_id as call_id, stale.elapsed, j.timeout_sec
        """,
        {"job": job_id, "tail": MAX_IDLE_TAIL_SEC},
    ).fetchone()
    if row is None:
        return None
    elapsed = float(row["elapsed"])
    return StaleCall(
        job_id=job_id,
        call_id=row["call_id"],
        elapsed_sec=elapsed,
        remaining_sec=max(0.0, float(row["timeout_sec"]) - elapsed),
    )


def cancel_stale_call(conn: Conn, cancel: Callable[[str], bool] | None, stale: StaleCall) -> bool:
    """Cancels a settled call on the GPU backend; False if it couldn't be.

    A call that can't be cancelled (no backend here, the backend unreachable)
    may run on to its function's own timeout, which is shorter than the job's
    limit: the rest of that limit is charged to the job at once, so the
    budget counts the worst case rather than nothing.
    """
    if stale.call_id is None:
        return True
    if cancel is not None and cancel(stale.call_id):
        get_logger(job_id=stale.job_id).info("gpu.call_cancelled", call_id=stale.call_id)
        return True
    conn.execute(
        """
        update jobs
        set gpu_cost_usd = coalesce(gpu_cost_usd, 0) + %s * coalesce(gpu_rate_usd, 0),
            updated_at = now()
        where id = %s
        """,
        (round(stale.remaining_sec, 3), stale.job_id),
    )
    get_logger(job_id=stale.job_id).error(
        "gpu.call_not_cancelled", call_id=stale.call_id, charged_sec=round(stale.remaining_sec)
    )
    return False


def succeed(
    conn: Conn, job: Job, worker_id: str, output_key: str, output_meta: dict[str, Any]
) -> bool:
    """Marks the job done and captures its credits; False if it was cancelled meanwhile."""
    with conn.transaction():
        row = conn.execute(
            """
            update jobs
            set status = 'succeeded', progress = 100, stage = 'done', output_key = %s,
                output_meta = %s, credits_charged = credits_quoted, finished_at = now(),
                updated_at = now()
            where id = %s and worker_id = %s and status = 'running'
            returning *
            """,
            (output_key, Jsonb(output_meta), job["id"], worker_id),
        ).fetchone()
        if row is None:
            return False
        capture(conn, row)
    return True


def fail(conn: Conn, job: Job, worker_id: str | None, code: str, detail: str) -> bool:
    """Marks the job failed and returns its credits; False if it was no longer running."""
    with conn.transaction():
        row = conn.execute(
            """
            update jobs
            set status = 'failed', error_code = %s, error_detail = %s, finished_at = now(),
                updated_at = now()
            where id = %s and status = 'running' and (%s::text is null or worker_id = %s)
            returning *
            """,
            (code, detail[:500], job["id"], worker_id, worker_id),
        ).fetchone()
        if row is None:
            return False
        release(conn, row)
    return True


def requeue(conn: Conn, job_id: str, worker_id: str) -> None:
    """A worker stopping on purpose hands its job back at once."""
    conn.execute(
        """
        update jobs
        set status = 'queued', worker_id = null, stage = null, progress = 0,
            heartbeat_at = null, queued_at = now(), updated_at = now()
        where id = %s and worker_id = %s and status = 'running'
        """,
        (job_id, worker_id),
    )


@dataclass(frozen=True)
class Reaped:
    #: Jobs that failed for good, so the caller can delete their input.
    failed: list[Job] = field(default_factory=list)
    #: GPU calls their dead workers left running, settled; the caller cancels them.
    calls: list[StaleCall] = field(default_factory=list)


def reap(conn: Conn) -> Reaped:
    """Running jobs whose worker went quiet: back to the queue, or failed after 3 attempts.

    Also settles a call left on a job that's no longer running and whose
    worker went quiet too (cancelled by its owner while that worker was dead):
    nobody else would cancel it or count it.
    """
    reaped = Reaped()
    log = get_logger()
    with conn.transaction():
        ended = conn.execute(
            """
            select id from jobs
            where gpu_call_at is not null and status <> 'running'
              and (heartbeat_at is null or heartbeat_at < now() - %s)
            for update skip locked
            """,
            (STALE_AFTER,),
        ).fetchall()
        for job in ended:
            call = settle_call(conn, str(job["id"]))
            if call is not None:
                reaped.calls.append(call)
        stale = conn.execute(
            """
            select * from jobs
            where status = 'running' and heartbeat_at < now() - %s
            for update skip locked
            """,
            (STALE_AFTER,),
        ).fetchall()
        for job in stale:
            if job.get("gpu_call_at") is not None:
                call = settle_call(conn, str(job["id"]))
                if call is not None:
                    reaped.calls.append(call)
            if job["attempts"] < MAX_ATTEMPTS:
                conn.execute(
                    """
                    update jobs
                    set status = 'queued', worker_id = null, stage = null, progress = 0,
                        heartbeat_at = null, queued_at = now(), updated_at = now()
                    where id = %s
                    """,
                    (job["id"],),
                )
                log.warning("job.requeued", job_id=str(job["id"]), tool_id=job["tool_id"])
            else:
                fail(conn, job, None, "WORKER_LOST", "the worker stopped answering three times")
                reaped.failed.append(job)
                log.error(
                    "job.failed",
                    job_id=str(job["id"]),
                    tool_id=job["tool_id"],
                    error_code="WORKER_LOST",
                )
    return reaped


def expire(conn: Conn) -> list[Job]:
    """Jobs queued for 15 minutes: expired, credits back. Returns them (their input goes too)."""
    expired: list[Job] = []
    with conn.transaction():
        rows = conn.execute(
            """
            update jobs
            set status = 'expired', error_code = 'EXPIRED', finished_at = now(), updated_at = now()
            where status = 'queued' and queued_at < now() - %s
            returning *
            """,
            (QUEUE_EXPIRY,),
        ).fetchall()
        for job in rows:
            release(conn, job)
            expired.append(job)
            get_logger().warning("job.expired", job_id=str(job["id"]), tool_id=job["tool_id"])
    return expired


def input_keys(job: Job) -> list[str]:
    """Every input a job holds in storage: the main one, then any extras (subtitles)."""
    keys = [str(job["input_key"])] if job.get("input_key") else []
    return keys + [str(key) for key in job.get("extra_input_keys") or []]


def input_gone(conn: Conn, job: Job, gone: list[str] | None = None) -> None:
    """Records that the job's inputs are deleted (the job row and the upload rows): all of
    them, or those in ``gone``. The job keeps the keys of any left, which the sweeper deletes
    once their uploads expire (no running job holds them)."""
    keys = input_keys(job)
    deleted = keys if gone is None else [key for key in keys if key in gone]
    if not deleted:
        return
    main = job.get("input_key")
    conn.execute(
        "update jobs set input_key = %s, extra_input_keys = %s where id = %s",
        (
            None if main is None or str(main) in deleted else str(main),
            [str(key) for key in job.get("extra_input_keys") or [] if str(key) not in deleted],
            job["id"],
        ),
    )
    conn.execute(
        "update uploads set deleted_at = now() where storage_key = any(%s) and deleted_at is null",
        (deleted,),
    )

"""The job queue: the ``jobs`` table (docs/01 -> Queue).

- Claim: the highest-priority, oldest queued job whose tool is under its
  concurrency cap, with ``FOR UPDATE SKIP LOCKED`` so workers never collide.
  CPU jobs and GPU jobs (those with a GPU rate) are claimed apart, by
  different slots, so a GPU call that waits on Modal for an hour never holds
  a slot that probes uploads and runs ffmpeg. GPU claims stop while the
  daily budget is spent (gpu/budget.py).
- Heartbeat every 5 s while running; it also notices a cancel.
- Reaper: a running job silent for 60 s goes back to the queue, at most
  twice; the third time it fails and its credits come back.
- Expiry: a job queued for 15 min is expired and its credits come back.

Every status change and its ledger row happen in one transaction.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from psycopg.types.json import Jsonb

from etb_worker.db import Conn
from etb_worker.gpu.budget import gpu_open
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

    While today's GPU budget is spent GPU jobs wait (gpu/budget.py); if they
    wait 15 minutes they expire and their credits come back.
    """
    with conn.transaction():
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


def record_gpu(conn: Conn, job_id: str, gpu_seconds: float, billed_seconds: float) -> None:
    """Adds a GPU call's time to the job, and its cost at the rate the job was created with.

    Whatever became of the job (a cancelled call still ran): this is what the
    daily budget and the admin's costs add up.
    """
    conn.execute(
        """
        update jobs
        set gpu_seconds = coalesce(gpu_seconds, 0) + %s,
            gpu_cost_usd = coalesce(gpu_cost_usd, 0) + %s * coalesce(gpu_rate_usd, 0),
            updated_at = now()
        where id = %s
        """,
        (round(gpu_seconds, 3), round(billed_seconds, 3), job_id),
    )


def reserve_output(conn: Conn, job_id: str, worker_id: str, key: str) -> None:
    """Records the key a GPU function is about to write, so it's found if this worker dies."""
    conn.execute(
        """
        update jobs set output_key = %s, updated_at = now()
        where id = %s and worker_id = %s and status = 'running'
        """,
        (key, job_id, worker_id),
    )


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


def reap(conn: Conn) -> list[Job]:
    """Running jobs whose worker went quiet: back to the queue, or failed after 3 attempts.

    Returns the jobs that failed for good, so the caller can delete their input.
    """
    failed: list[Job] = []
    log = get_logger()
    with conn.transaction():
        stale = conn.execute(
            """
            select * from jobs
            where status = 'running' and heartbeat_at < now() - %s
            for update skip locked
            """,
            (STALE_AFTER,),
        ).fetchall()
        for job in stale:
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
                failed.append(job)
                log.error(
                    "job.failed",
                    job_id=str(job["id"]),
                    tool_id=job["tool_id"],
                    error_code="WORKER_LOST",
                )
    return failed


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


def input_gone(conn: Conn, job: Job) -> None:
    """Records that the job's inputs are deleted (the job row and the upload rows)."""
    keys = input_keys(job)
    if not keys:
        return
    conn.execute(
        "update jobs set input_key = null, extra_input_keys = '{}' where id = %s", (job["id"],)
    )
    conn.execute(
        "update uploads set deleted_at = now() where storage_key = any(%s) and deleted_at is null",
        (keys,),
    )

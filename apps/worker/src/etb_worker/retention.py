"""The retention sweeper (docs/01 -> Retention: "the sweeper is the real guarantee").

Every 5 minutes, one worker:
- deletes outputs 60 minutes after their job finished;
- deletes every key a GPU call was given a PUT URL for, other than its
  job's live output, on every pass until that URL has expired. A call whose
  worker died may still write to one long after its job moved on; this way
  nothing it writes stays more than one pass (5 minutes), and the job's
  real output keeps its own 60 minutes;
- aborts multipart uploads nobody completed within the hour, ours and any
  storage still lists. Ours are deleted too: storage may have completed one
  while the web failed to record it, and then the file is there;
- deletes completed uploads no job used before they expired;
- then lists the bucket: anything older than 2 hours means the sweeper is
  missing something, and alerts.

Bucket lifecycle rules (1-day expiry, 1-day multipart abort) are only the
backstop; they exist on R2, not on the local gateway, and are checked daily.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from etb_worker.alerts import Alert
from etb_worker.db import Conn, record_check
from etb_worker.logs import get_logger
from etb_worker.storage import Storage, StorageError

OUTPUT_TTL = timedelta(minutes=60)
UPLOAD_TTL = timedelta(hours=1)
TOO_OLD = timedelta(hours=2)
SWEEP_EVERY = timedelta(minutes=5)


def sweep(
    conn: Conn, storage: Storage, now: datetime | None = None
) -> tuple[dict[str, int], list[Alert]]:
    """One pass; returns the counts and any alerts to raise."""
    now = now or datetime.now(UTC)
    counts = {
        "outputs": 0,
        "gpu_keys": 0,
        "uploads_aborted": 0,
        "uploads_deleted": 0,
        "orphans_aborted": 0,
    }
    log = get_logger()

    outputs = conn.execute(
        """
        select id, output_key from jobs
        where output_key is not null and finished_at < now() - %s
        """,
        (OUTPUT_TTL,),
    ).fetchall()
    for job in outputs:
        storage.delete(job["output_key"])
        conn.execute(
            "update jobs set output_key = null, files_deleted_at = now() where id = %s",
            (job["id"],),
        )
        counts["outputs"] += 1

    counts["gpu_keys"] = _sweep_gpu_keys(conn, storage)

    stale = conn.execute(
        """
        select id, storage_key, multipart_id from uploads
        where multipart_id is not null and (expires_at < now() or created_at < now() - %s)
        """,
        (UPLOAD_TTL,),
    ).fetchall()
    for upload in stale:
        storage.abort_upload(upload["storage_key"], upload["multipart_id"])
        # Storage may have completed it while the web failed to record that (it died, or
        # its database write failed): the abort then does nothing and the file stays.
        storage.delete(upload["storage_key"])
        conn.execute(
            "update uploads set multipart_id = null, deleted_at = now() where id = %s",
            (upload["id"],),
        )
        counts["uploads_aborted"] += 1

    unused = conn.execute(
        """
        select u.id, u.storage_key from uploads u
        where u.completed_at is not null and u.deleted_at is null and u.expires_at < now()
          and not exists (
            select 1 from jobs j
            where (j.input_key = u.storage_key or u.storage_key = any(j.extra_input_keys))
              and j.status in ('queued', 'running')
          )
        """
    ).fetchall()
    for upload in unused:
        storage.delete(upload["storage_key"])
        conn.execute("update uploads set deleted_at = now() where id = %s", (upload["id"],))
        counts["uploads_deleted"] += 1

    for open_upload in storage.open_uploads():
        if now - open_upload.started > UPLOAD_TTL:
            storage.abort_upload(open_upload.key, open_upload.upload_id)
            counts["orphans_aborted"] += 1

    alerts: list[Alert] = []
    old = [item for item in storage.objects() if now - item.modified > TOO_OLD]
    if old:
        alerts.append(
            Alert(
                "storage_old_objects",
                "bucket",
                f"{len(old)} object(s) in storage are older than 2 hours; the sweeper should "
                "have deleted them.",
            )
        )
    left_open = [item for item in storage.open_uploads() if now - item.started > TOO_OLD]
    if left_open:
        alerts.append(
            Alert(
                "storage_open_uploads",
                "bucket",
                f"{len(left_open)} multipart upload(s) are open longer than 2 hours.",
            )
        )
    detail: dict[str, Any] = {**counts, "old_objects": len(old), "open_uploads": len(left_open)}
    record_check(conn, "retention_sweeper", ok=not alerts, detail=detail)
    if any(counts.values()):
        log.info("retention.swept", **counts)
    return counts, alerts


def _sweep_gpu_keys(conn: Conn, storage: Storage) -> int:
    """Deletes GPU output keys nothing should be in; returns how many deletes it sent.

    The live output (the output of a running or succeeded job) is left to the
    60-minute rule above. Once the last URL has expired nothing can write to
    the keys any more: after one last delete they're forgotten.
    """
    deletes = 0
    jobs = conn.execute(
        """
        select id, status, output_key, gpu_output_keys, gpu_put_expires_at,
               gpu_put_expires_at < now() as expired
        from jobs
        where gpu_put_expires_at is not null
        """
    ).fetchall()
    for job in jobs:
        live = job["output_key"] if job["status"] in ("running", "succeeded") else None
        for key in job["gpu_output_keys"]:
            if key != live:
                storage.delete(key)
                deletes += 1
        if job["expired"]:
            # Guarded: a new attempt may have just added a key and moved the expiry on.
            conn.execute(
                """
                update jobs set gpu_output_keys = '{}', gpu_put_expires_at = null
                where id = %s and gpu_put_expires_at = %s
                """,
                (job["id"], job["gpu_put_expires_at"]),
            )
    return deletes


def lifecycle_check(conn: Conn, storage: Storage) -> list[Alert]:
    """The backstop rules exist: 1-day expiry and 1-day multipart abort (docs/11 -> Storage)."""
    try:
        config = storage.lifecycle()
    except StorageError as error:
        record_check(conn, "lifecycle_rules", ok=False, detail={"error": error.code})
        return [Alert("lifecycle_missing", "bucket", "Couldn't read the bucket's lifecycle rules.")]
    if config is None:
        # The local gateway has none (docs/12 -> M4): the sweeper is the only cleanup here.
        record_check(conn, "lifecycle_rules", ok=True, detail={"supported": False})
        return []
    rules = [rule for rule in config.get("Rules", []) if rule.get("Status") == "Enabled"]
    expires = any((rule.get("Expiration") or {}).get("Days") == 1 for rule in rules)
    aborts = any(
        (rule.get("AbortIncompleteMultipartUpload") or {}).get("DaysAfterInitiation") == 1
        for rule in rules
    )
    record_check(
        conn, "lifecycle_rules", ok=expires and aborts, detail={"expiry": expires, "abort": aborts}
    )
    if expires and aborts:
        return []
    return [
        Alert(
            "lifecycle_missing",
            "bucket",
            "The bucket's lifecycle rules are missing: "
            "need 1-day expiry and 1-day multipart abort.",
        )
    ]

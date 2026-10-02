"""The job queue, runner and sweeper against real Postgres 18, storage and ffmpeg.

Runs when TEST_DATABASE_URL is set (migrated) and storage answers at
TEST_S3_ENDPOINT (default: the local stack's gateway), in its own bucket.
Covers docs/12 -> M4's done-when on the worker side: the input is gone as
soon as the job ends, outputs within the hour, a worker that dies mid-job
has its job requeued, and broken files fail cleanly.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import boto3
import pytest
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from psycopg.types.json import Jsonb

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.probe import probe_next
from etb_worker.processors import (
    PROCESSORS,
    Estimate,
    JobContext,
    JobFailed,
    Output,
    Processor,
    ffmpeg_progress,
)
from etb_worker.retention import lifecycle_check, sweep
from etb_worker.runner import JobRunner
from etb_worker.sandbox import ffmpeg
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError

URL = os.environ.get("TEST_DATABASE_URL", "")
S3 = os.environ.get("TEST_S3_ENDPOINT", "http://127.0.0.1:7070")
BUCKET = "etb-test-worker"


def _storage_up() -> bool:
    client = boto3.client(
        "s3",
        endpoint_url=S3,
        region_name="us-east-1",
        aws_access_key_id="etb-local",
        aws_secret_access_key="etb-local-secret",
        config=Config(
            s3={"addressing_style": "path"}, connect_timeout=2, retries={"max_attempts": 1}
        ),
    )
    try:
        client.head_bucket(Bucket=BUCKET)
    except ClientError:
        try:
            client.create_bucket(Bucket=BUCKET)
        except (BotoCoreError, ClientError):
            return False
    except BotoCoreError:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not URL or not _storage_up(), reason="needs TEST_DATABASE_URL and storage at TEST_S3_ENDPOINT"
)


@pytest.fixture
def storage(clean_env: pytest.MonkeyPatch) -> Storage:
    for name, value in {
        "DATABASE_URL": URL,
        "S3_ENDPOINT": S3,
        "S3_REGION": "us-east-1",
        "S3_BUCKET": BUCKET,
        "S3_ACCESS_KEY_ID": "etb-local",
        "S3_SECRET_ACCESS_KEY": "etb-local-secret",
    }.items():
        clean_env.setenv(name, value)
    return Storage(Settings())


@pytest.fixture
def db() -> Iterator[Conn]:
    with connect_url(URL) as conn:
        yield conn


def one(db: Conn, query: str, *params: Any) -> dict[str, Any]:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row


def exists(storage: Storage, key: str) -> bool:
    return any(item.key == key for item in storage.objects())


def new_user(db: Conn, credits: int = 0) -> str:
    user = str(
        one(
            db,
            "insert into users (email) values (%s) returning id",
            f"{uuid.uuid4().hex[:12]}@example.test",
        )["id"]
    )
    if credits:
        db.execute(
            """
            insert into credit_transactions (user_id, kind, amount, balance_after)
            values (%s, 'welcome_grant', %s, %s)
            """,
            (user, credits, credits),
        )
        db.execute("update users set credit_balance = %s where id = %s", (credits, user))
    return user


def put_input(storage: Storage, path: Path) -> str:
    key = f"in/{uuid.uuid4()}"
    storage._client.upload_file(str(path), storage.bucket, key)  # test setup
    return key


def new_job(
    db: Conn, user: str, key: str, *, tool: str = "test-remux", quote: int = 0, **cols: Any
) -> str:
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, 1, 'video/mp4', %s, 1, 1, now() + interval '1 hour', now(), now())
        """,
        (user, key, tool),
    )
    values = {
        "tool_id": tool,
        "user_id": user,
        "source": "web",
        "input_key": key,
        "input_meta": Jsonb({"duration_ms": 2000}),
        "credits_quoted": quote,
        **cols,
    }
    names = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    job = str(
        one(db, f"insert into jobs ({names}) values ({marks}) returning id", *values.values())["id"]  # noqa: S608
    )
    if quote:
        balance = int(
            one(db, "select credit_balance from users where id = %s", user)["credit_balance"]
        )
        db.execute(
            """
            insert into credit_transactions (user_id, kind, amount, balance_after, job_id)
            values (%s, 'reserve', %s, %s, %s)
            """,
            (user, -quote, balance - quote, job),
        )
        db.execute("update users set credit_balance = %s where id = %s", (balance - quote, user))
    return job


class Remux:
    """A test processor: copies the streams into a new MP4, reporting progress."""

    tool_id = "test-remux"

    def __init__(self, slow: bool = False) -> None:
        self.slow = slow

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        return Estimate(seconds=1)

    def run(self, ctx: JobContext) -> Output:
        if self.slow:
            ctx.run(["sleep", "30"])
        if ctx.options.get("fail"):
            raise JobFailed("DECODE_FAILED", "the video can't be decoded")
        out = ctx.workdir / "out.mp4"
        report = ffmpeg_progress(int(ctx.meta.get("duration_ms", 0)), ctx.progress, "remuxing")
        ctx.run(
            ffmpeg("-i", ctx.input_path.name, "-c", "copy", "-f", "mp4", out.name), on_line=report
        )
        return Output(path=out, content_type="video/mp4", ext="mp4", meta={"kind": "remux"})


def runner(storage: Storage, processor: Processor | None = None) -> JobRunner:
    return JobRunner(
        storage,
        lambda: connect_url(URL),
        processors={"test-remux": processor or Remux()},
        worker_id=f"test-{uuid.uuid4().hex[:6]}",
        heartbeat_sec=0.2,
    )


def claim_this(db: Conn, run: JobRunner, job: str) -> jobqueue.Job:
    """Claims ``job`` in particular (other tests may leave queued jobs behind)."""
    db.execute("update jobs set priority = 10 where id = %s", (job,))
    claimed = jobqueue.claim(db, run.worker_id)
    assert claimed is not None
    assert str(claimed["id"]) == job
    return claimed


def test_probe_records_what_a_file_is_and_refuses_broken_ones(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    ids = {}
    for name in ("mp4", "garbage"):
        key = put_input(storage, media[name])
        ids[name] = str(
            one(
                db,
                """
                insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                                     part_count, expires_at, completed_at)
                values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1,
                        now() + interval '1 hour', now())
                returning id
                """,
                user,
                key,
            )["id"]
        )
    while probe_next(db, storage):
        pass
    good = one(db, "select probe, probe_error from uploads where id = %s", ids["mp4"])
    assert good["probe_error"] is None
    assert good["probe"]["video"]["width"] == 160
    bad = one(db, "select probe, probe_error, probed_at from uploads where id = %s", ids["garbage"])
    assert bad["probe"] is None
    assert bad["probe_error"] == "UNSUPPORTED_FORMAT"


def test_an_upload_whose_file_is_gone_is_refused_and_holds_up_nothing(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    keys = [f"in/{uuid.uuid4()}", put_input(storage, media["mp4"])]
    ids = [
        str(
            one(
                db,
                """
                insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                                     part_count, expires_at, completed_at)
                values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1,
                        now() + interval '1 hour', now() - make_interval(secs => %s))
                returning id
                """,
                user,
                key,
                60 - n,
            )["id"]
        )
        for n, key in enumerate(keys)
    ]
    passes = 0
    while probe_next(db, storage):
        passes += 1
        assert passes < 50, "probing never settled"
    gone = one(db, "select probe_error, probed_at from uploads where id = %s", ids[0])
    assert gone["probe_error"] == "MISSING"
    assert gone["probed_at"] is not None
    there = one(db, "select probe, probe_error from uploads where id = %s", ids[1])
    assert there["probe_error"] is None
    assert there["probe"]["video"]["width"] == 160


def test_a_job_runs_end_to_end_and_its_input_is_gone_at_once(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=3)
    run = runner(storage)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    assert row["progress"] == 100
    assert row["credits_charged"] == 3
    assert row["input_key"] is None
    assert row["output_meta"]["content_type"] == "video/mp4"
    assert row["output_meta"]["bytes"] > 1000
    assert exists(storage, row["output_key"])
    assert not exists(storage, key)
    assert one(db, "select deleted_at from uploads where storage_key = %s", key)["deleted_at"]
    kinds = [
        r["kind"]
        for r in db.execute(
            "select kind from credit_transactions where job_id = %s order by created_at", (job,)
        ).fetchall()
    ]
    assert kinds == ["reserve", "capture"]
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 7


class ReadsExtras(Remux):
    """Remuxes, and records what its extra input said (Burn Subtitles' subtitle file)."""

    def run(self, ctx: JobContext) -> Output:
        output = super().run(ctx)
        return Output(
            path=output.path,
            content_type=output.content_type,
            ext=output.ext,
            meta={"extra": [path.read_text() for path in ctx.extra_paths]},
        )


def test_extra_inputs_reach_the_tool_and_go_with_the_job(
    db: Conn, storage: Storage, media: dict[str, Any], tmp_path: Path
) -> None:
    user = new_user(db)
    key = put_input(storage, media["mp4"])
    subtitles = tmp_path / "subs.srt"
    subtitles.write_text("1\n00:00:00,500 --> 00:00:01,000\nHi\n")
    extra = put_input(storage, subtitles)
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, 1, 'application/x-subrip', 'test-remux', 1, 1,
                now() + interval '1 hour', now(), now())
        """,
        (user, extra),
    )
    job = new_job(db, user, key, extra_input_keys=[extra])
    run = runner(storage, ReadsExtras())
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    assert row["output_meta"]["extra"] == [subtitles.read_text()]
    assert (row["input_key"], row["extra_input_keys"]) == (None, [])
    assert not exists(storage, key)
    assert not exists(storage, extra)
    assert one(db, "select deleted_at from uploads where storage_key = %s", extra)["deleted_at"]


def put_clip(db: Conn, storage: Storage, user: str, path: Path) -> str:
    """A completed, probed upload of a clip for Merge Videos."""
    key = put_input(storage, path)
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, 1, 'video/mp4', 'merge-videos', 1, 1,
                now() + interval '1 hour', now(), now())
        """,
        (user, key),
    )
    return key


def merge_runner(storage: Storage) -> JobRunner:
    return JobRunner(
        storage,
        lambda: connect_url(URL),
        processors={"merge-videos": PROCESSORS["merge-videos"]},
        worker_id=f"test-{uuid.uuid4().hex[:6]}",
        heartbeat_sec=0.2,
    )


@pytest.mark.parametrize("outcome", ["succeeded", "failed"])
def test_every_clip_of_a_merge_goes_when_the_job_ends(
    db: Conn, storage: Storage, media: dict[str, Any], outcome: str
) -> None:
    user = new_user(db, credits=10)
    # The first clip's upload row comes with the job; the others have their own.
    keys = [put_input(storage, media["mp4"])] + [
        put_clip(db, storage, user, media["mp4"]) for _ in range(2)
    ]
    # A 1 s crossfade is too long for 2 s clips: the job fails, after its clips arrived.
    options = {"transition": "crossfade", "transitionLength": "2" if outcome == "failed" else "1"}
    job = new_job(
        db,
        user,
        keys[0],
        tool="merge-videos",
        quote=3,
        extra_input_keys=keys[1:],
        options=Jsonb(options),
        # Each clip's probe, as the jobs API passes them on: their lengths priced the job.
        input_meta=Jsonb(
            {
                "duration_ms": 2000,
                "mime": "video/mp4",
                "extras": [{"duration_ms": 2000, "mime": "video/mp4"}] * 2,
            }
        ),
    )
    run = merge_runner(storage)
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == outcome
    if outcome == "failed":
        assert row["error_code"] == "CROSSFADE_TOO_LONG"
    else:
        assert exists(storage, row["output_key"])
        assert row["output_meta"]["notes"][0] == "3 clips joined with 1.00 s crossfades: 4.00 s"
        storage.delete(row["output_key"])
    assert (row["input_key"], row["extra_input_keys"]) == (None, [])
    for key in keys:
        assert not exists(storage, key)
        assert one(db, "select deleted_at from uploads where storage_key = %s", key)["deleted_at"]
    balance = one(db, "select credit_balance from users where id = %s", user)["credit_balance"]
    assert balance == (7 if outcome == "succeeded" else 10)


class FlakyDelete(Storage):
    """Storage that refuses to delete one key, as a storage blip would."""

    def __init__(self, inner: Storage, refuse: str) -> None:
        self.__dict__.update(inner.__dict__)
        self.refuse = refuse

    def delete(self, key: str) -> None:
        if key == self.refuse:
            raise StorageError("InternalError", "storage blinked")
        super().delete(key)


def test_one_input_that_wont_delete_doesnt_keep_the_others(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    # The first clip's upload row comes with the job; the others have their own.
    keys = [put_input(storage, media["mp4"])] + [
        put_clip(db, storage, user, media["mp4"]) for _ in range(2)
    ]
    job = new_job(db, user, keys[0], extra_input_keys=keys[1:])
    run = runner(FlakyDelete(storage, keys[1]))
    run.run(claim_this(db, run, job))

    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "succeeded"
    assert not exists(storage, keys[0])
    assert exists(storage, keys[1])
    assert not exists(storage, keys[2])
    # The job keeps the one left; its upload expires and the sweeper deletes it.
    assert (row["input_key"], row["extra_input_keys"]) == (None, [keys[1]])
    deleted = {
        r["storage_key"]: r["deleted_at"]
        for r in db.execute(
            "select storage_key, deleted_at from uploads where storage_key = any(%s)", (keys,)
        ).fetchall()
    }
    assert deleted[keys[0]] is not None
    assert deleted[keys[1]] is None
    assert deleted[keys[2]] is not None
    storage.delete(keys[1])
    storage.delete(row["output_key"])


def test_a_failed_job_returns_its_credits_and_drops_its_input(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=3, options=Jsonb({"fail": True}))
    run = runner(storage)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "DECODE_FAILED")
    assert row["output_key"] is None
    assert not exists(storage, key)
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 10


def test_a_malformed_input_fails_cleanly(db: Conn, storage: Storage, media: dict[str, Any]) -> None:
    user = new_user(db)
    key = put_input(storage, media["garbage"])
    job = new_job(db, user, key)
    run = runner(storage)
    run.run(claim_this(db, run, job))
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "TOOL_FAILED")
    assert not exists(storage, key)


def test_cancelling_a_running_job_stops_its_tool(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key)
    run = runner(storage, Remux(slow=True))
    claimed = claim_this(db, run, job)

    def cancel_soon() -> None:
        time.sleep(1)
        with connect_url(URL) as conn:
            conn.execute(
                "update jobs set status = 'cancelled', finished_at = now() where id = %s", (job,)
            )

    threading.Thread(target=cancel_soon).start()
    started = time.monotonic()
    run.run(claimed)
    assert time.monotonic() - started < 10
    row = one(db, "select * from jobs where id = %s", job)
    assert row["status"] == "cancelled"
    assert row["output_key"] is None
    assert not exists(storage, key)


def test_a_worker_stopping_hands_its_job_back(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key)
    run = runner(storage, Remux(slow=True))
    claimed = claim_this(db, run, job)
    threading.Timer(1, run.stop_current).start()
    run.run(claimed)
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["worker_id"]) == ("queued", None)
    assert exists(storage, key)  # kept for the next worker
    db.execute("update jobs set status = 'cancelled' where id = %s", (job,))


def test_a_worker_that_dies_mid_job_has_it_requeued_then_failed(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=5)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=2)
    dead = runner(storage)
    claim_this(db, dead, job)
    # The worker vanished: no heartbeat for two minutes.
    db.execute("update jobs set heartbeat_at = now() - interval '2 minutes' where id = %s", (job,))
    jobqueue.reap(db)
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["attempts"], row["worker_id"]) == ("queued", 1, None)

    # Another worker picks it up and finishes it.
    run = runner(storage)
    run.run(claim_this(db, run, job))
    assert one(db, "select status from jobs where id = %s", job)["status"] == "succeeded"

    # A job that loses its worker three times fails, and its credits come back.
    user2 = new_user(db, credits=5)
    key2 = put_input(storage, media["mp4"])
    job2 = new_job(db, user2, key2, quote=2)
    db.execute(
        """
        update jobs set status = 'running', attempts = 3, worker_id = 'gone',
                        heartbeat_at = now() - interval '2 minutes'
        where id = %s
        """,
        (job2,),
    )
    failed = jobqueue.reap(db).failed
    assert job2 in [str(item["id"]) for item in failed]
    row2 = one(db, "select * from jobs where id = %s", job2)
    assert (row2["status"], row2["error_code"]) == ("failed", "WORKER_LOST")
    assert one(db, "select credit_balance from users where id = %s", user2)["credit_balance"] == 5
    storage.delete(key2)


def test_jobs_queued_too_long_expire_with_their_credits_back(db: Conn, storage: Storage) -> None:
    user = new_user(db, credits=4)
    job = new_job(db, user, f"in/{uuid.uuid4()}", quote=4)
    db.execute("update jobs set queued_at = now() - interval '20 minutes' where id = %s", (job,))
    expired = jobqueue.expire(db)
    assert job in [str(item["id"]) for item in expired]
    assert one(db, "select status from jobs where id = %s", job)["status"] == "expired"
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 4


def test_claims_respect_priority_skip_locked_and_the_tool_cap(db: Conn, storage: Storage) -> None:
    tool = f"test-cap-{uuid.uuid4().hex[:6]}"
    user = new_user(db)
    first = new_job(db, user, f"in/{uuid.uuid4()}", tool=tool, max_concurrent=1, priority=20)
    second = new_job(db, user, f"in/{uuid.uuid4()}", tool=tool, max_concurrent=1, priority=20)
    claimed = jobqueue.claim(db, "w1")
    assert claimed is not None
    assert str(claimed["id"]) == first
    # The cap of 1 keeps the second waiting while the first runs.
    with connect_url(URL) as other:
        again = jobqueue.claim(other, "w2")
    assert again is None or str(again["id"]) != second
    if again is not None:
        db.execute("update jobs set status = 'cancelled' where id = %s", (again["id"],))
    db.execute("update jobs set status = 'cancelled' where id in (%s, %s)", (first, second))


def test_the_sweeper_deletes_old_outputs_and_abandoned_uploads(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db)
    # An output finished two hours ago.
    out_key = f"out/{uuid.uuid4()}"
    storage._client.upload_file(str(media["mp4"]), storage.bucket, out_key)
    job = new_job(db, user, f"in/{uuid.uuid4()}")
    db.execute(
        """
        update jobs set status = 'succeeded', output_key = %s, input_key = null,
                        finished_at = now() - interval '2 hours'
        where id = %s
        """,
        (out_key, job),
    )
    # A multipart upload nobody finished.
    open_key = f"in/{uuid.uuid4()}"
    started = storage._client.create_multipart_upload(Bucket=storage.bucket, Key=open_key)
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, multipart_id, created_at)
        values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1, now() - interval '1 minute', %s,
                now() - interval '61 minutes')
        """,
        (user, open_key, started["UploadId"]),
    )
    # A completed upload no job used.
    unused_key = put_input(storage, media["mp4"])
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at)
        values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1, now() - interval '1 minute', now())
        """,
        (user, unused_key),
    )
    counts, _alerts = sweep(db, storage, now=datetime.now(UTC))
    assert counts["outputs"] >= 1
    assert counts["uploads_aborted"] >= 1
    assert counts["uploads_deleted"] >= 1
    assert not exists(storage, out_key)
    assert not exists(storage, unused_key)
    assert all(item.key != open_key for item in storage.open_uploads())
    row = one(db, "select output_key, files_deleted_at from jobs where id = %s", job)
    assert row["output_key"] is None
    assert row["files_deleted_at"] is not None
    check = one(db, "select detail from system_checks where name = 'retention_sweeper'")
    assert check["detail"]["outputs"] >= 1


def test_the_sweeper_alerts_on_anything_older_than_two_hours(db: Conn, storage: Storage) -> None:
    key = f"stray/{uuid.uuid4()}"
    storage._client.put_object(Bucket=storage.bucket, Key=key, Body=b"x")
    _counts, alerts = sweep(db, storage, now=datetime.now(UTC) + timedelta(hours=3))
    assert "storage_old_objects" in [alert.rule for alert in alerts]
    storage.delete(key)


def test_lifecycle_rules_read_as_not_supported_on_the_local_gateway(
    db: Conn, storage: Storage
) -> None:
    assert lifecycle_check(db, storage) == []
    check = one(db, "select ok, detail from system_checks where name = 'lifecycle_rules'")
    assert check["ok"] is True
    assert check["detail"] == {"supported": False}

"""A job's time limit through the real job path (finding W5).

Runs like test_jobs_db.py: against real Postgres 18 and storage, when
TEST_DATABASE_URL is set and storage answers at TEST_S3_ENDPOINT.

``jobs.timeout_sec`` is one limit for the whole job, from the moment its
runner starts it: the download and every run of the tool count against it,
and a job past it uploads nothing. It fails as TIMEOUT like any timed-out
job: credits back once, input gone.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from etb_worker.db import Conn
from etb_worker.processors import Estimate, JobContext, Output
from etb_worker.storage import Storage
from tests import test_jobs_db as jobs_db
from tests.test_jobs_db import claim_this, exists, new_job, new_user, one, put_input, runner

# The same needs and the same fixtures as the queue's own tests.
pytestmark = jobs_db.pytestmark
db = jobs_db.db
storage = jobs_db.storage


class Recording(Storage):
    """Storage that notes what was uploaded, and can take its time over a download."""

    def __init__(self, inner: Storage, download_sec: float = 0) -> None:
        self.__dict__.update(inner.__dict__)
        self.download_sec = download_sec
        self.uploaded: list[str] = []

    def download(self, key: str, dest: Path) -> int:
        time.sleep(self.download_sec)
        return super().download(key, dest)

    def upload(self, source: Path, content_type: str, key: str) -> str:
        self.uploaded.append(key)
        return super().upload(source, content_type, key)


class Steps:
    """A test processor: sandbox runs of so many seconds each, then a pause of its own."""

    tool_id = "test-remux"

    def __init__(self, runs: list[float], pause: float = 0) -> None:
        self.runs, self.pause = runs, pause
        self.started = 0

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        return Estimate(seconds=1)

    def run(self, ctx: JobContext) -> Output:
        for seconds in self.runs:
            self.started += 1
            ctx.run(["sleep", str(seconds)])
        time.sleep(self.pause)
        out = ctx.workdir / "out.bin"
        out.write_bytes(b"done")
        return Output(path=out, content_type="application/octet-stream", ext="bin")


def timed_out(db: Conn, storage: Recording, job: str, user: str, key: str) -> None:
    """The job failed as TIMEOUT the way every failed job does: nothing stored, the input
    gone, the credits back exactly once."""
    row = one(db, "select * from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "TIMEOUT")
    assert row["output_key"] is None
    assert storage.uploaded == []
    assert row["input_key"] is None
    assert not exists(storage, key)
    kinds = [
        r["kind"]
        for r in db.execute(
            "select kind from credit_transactions where job_id = %s order by created_at", (job,)
        ).fetchall()
    ]
    assert kinds == ["reserve", "release"]
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 10


def test_a_jobs_runs_share_its_time_limit(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    # Each run fits the limit on its own; the two together don't.
    job = new_job(db, user, key, quote=3, timeout_sec=2)
    recording = Recording(storage)
    run = runner(recording, Steps([1.5, 1.5]))
    run.run(claim_this(db, run, job))
    timed_out(db, recording, job, user, key)


def test_a_job_within_its_limit_still_succeeds(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=3, timeout_sec=20)
    recording = Recording(storage)
    run = runner(recording, Steps([0.3, 0.3]))
    run.run(claim_this(db, run, job))
    row = one(db, "select status, output_key from jobs where id = %s", job)
    assert (row["status"], recording.uploaded) == ("succeeded", [row["output_key"]])
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 7
    storage.delete(row["output_key"])


def test_the_download_counts_against_the_limit(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=3, timeout_sec=1)
    recording = Recording(storage, download_sec=1.3)
    steps = Steps([0.1])
    run = runner(recording, steps)
    run.run(claim_this(db, run, job))
    timed_out(db, recording, job, user, key)
    assert steps.started == 1  # it asked for its run, and none was given


def test_a_job_past_its_limit_uploads_nothing(
    db: Conn, storage: Storage, media: dict[str, Any]
) -> None:
    user = new_user(db, credits=10)
    key = put_input(storage, media["mp4"])
    job = new_job(db, user, key, quote=3, timeout_sec=1)
    recording = Recording(storage)
    # No run to stop: the tool's own work ends after the limit, with an output ready.
    run = runner(recording, Steps([], pause=1.3))
    run.run(claim_this(db, run, job))
    timed_out(db, recording, job, user, key)

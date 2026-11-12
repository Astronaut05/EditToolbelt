"""The scheduler's upkeep when a row it needs is held by someone else (finding W10).

Runs like test_jobs_db.py: against real Postgres 18 and storage, when
TEST_DATABASE_URL is set and storage answers at TEST_S3_ENDPOINT.

Every connection gives up on a lock after 5 s (db.py), so the tick no longer
waits without end. What it gives up on waits for the next tick; the deletes
that keep a person's files from outliving their job must not wait with it.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.notify import Notifier
from etb_worker.scheduler import Scheduler
from etb_worker.settings import Settings
from etb_worker.storage import Storage
from tests import test_jobs_db as jobs_db
from tests.test_jobs_db import URL, exists, new_job, new_user, one

# The same needs and the same fixtures as the queue's own tests.
pytestmark = jobs_db.pytestmark
db = jobs_db.db
storage = jobs_db.storage


def swept_just_now(db: Conn) -> None:
    """The 5-minute sweep has its own tests: here it counts as done."""
    db.execute(
        """
        insert into system_checks (name, ok, detail, ran_at)
        values ('retention_sweeper', true, '{}', now())
        on conflict (name) do update set ran_at = excluded.ran_at
        """
    )


def test_a_queued_job_someone_holds_does_not_stop_the_input_deletes(
    db: Conn, storage: Storage
) -> None:
    settings = Settings()
    sched = Scheduler(
        settings, Notifier(settings), connect=lambda _s: connect_url(URL), storage=storage
    )
    # Ended jobs other tests left with their inputs go first: a tick takes only so many.
    for _ in range(100):
        if not jobqueue.ended_with_inputs(db, limit=1):
            break
        swept_just_now(db)
        sched.maintain(db)

    user = new_user(db)
    key = f"in/{uuid.uuid4()}"
    storage._client.put_object(Bucket=storage.bucket, Key=key, Body=b"a person's file")  # setup
    ended = new_job(db, user, key)
    db.execute("update jobs set status = 'cancelled', finished_at = now() where id = %s", (ended,))
    waiting = new_job(db, user, f"in/{uuid.uuid4()}")
    db.execute(
        "update jobs set queued_at = now() - interval '20 minutes' where id = %s", (waiting,)
    )

    def status() -> str:
        return str(one(db, "select status from jobs where id = %s", waiting)["status"])

    swept_just_now(db)
    with connect_url(URL) as other, other.transaction():
        # Someone holds the job that is due to expire, for longer than the tick will wait.
        other.execute("select 1 from jobs where id = %s for update", (waiting,))
        with connect_url(URL, lock_timeout=timedelta(milliseconds=300)) as conn:
            sched.maintain(conn)
        assert status() == "queued"
        # The ended job's input went all the same.
        assert not exists(storage, key)
        assert one(db, "select input_key from jobs where id = %s", ended)["input_key"] is None

    # The row is free again: the next tick expires the job.
    swept_just_now(db)
    sched.maintain(db)
    assert status() == "expired"

"""An ended job's inputs go even when nobody was left to delete them (finding W2).

Runs like test_jobs_db.py: against real Postgres 18 and storage, when
TEST_DATABASE_URL is set and storage answers at TEST_S3_ENDPOINT.

A runner deletes its job's inputs as the job ends. Three ends have no runner
to do it: a job cancelled while its worker was dead, a job the reaper failed
in a tick that died before deleting the input, and a job whose runner was
killed just after marking it. The scheduler finds all of them from the rows,
on every tick, and leaves alone any job whose runner may still be at work.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any, cast

import pytest
from psycopg.types.json import Jsonb

from etb_worker import jobqueue
from etb_worker.db import Conn, connect_url
from etb_worker.notify import Notifier
from etb_worker.scheduler import Scheduler
from etb_worker.settings import Settings
from etb_worker.storage import Storage, StorageError
from tests import test_jobs_db as jobs_db
from tests.test_jobs_db import (
    URL,
    FlakyDelete,
    Killed,
    claim_this,
    exists,
    new_job,
    new_user,
    one,
    put_input,
    runner,
)

# The same needs and the same fixtures as the queue's own tests.
pytestmark = jobs_db.pytestmark
db = jobs_db.db
storage = jobs_db.storage


def scheduler(storage: Storage) -> Scheduler:
    settings = Settings()
    return Scheduler(
        settings, Notifier(settings), connect=lambda _s: connect_url(URL), storage=storage
    )


def tick(db: Conn, storage: Storage, sched: Scheduler | None = None) -> None:
    """One tick's upkeep of the queue. The 5-minute sweep is marked as just run: it has its
    own tests, and nothing here may wait for it."""
    db.execute(
        """
        insert into system_checks (name, ok, detail, ran_at)
        values ('retention_sweeper', true, '{}', now())
        on conflict (name) do update set ran_at = excluded.ran_at
        """
    )
    (sched or scheduler(storage)).maintain(db)


@pytest.fixture(autouse=True)
def no_backlog(db: Conn, storage: Storage) -> None:
    """Other tests leave ended jobs with inputs behind, and a tick takes only so many:
    they go first, so that one tick is enough for what a test sets up."""
    for _ in range(100):
        if not jobqueue.ended_with_inputs(db, limit=1):
            return
        tick(db, storage)
    pytest.fail("ended jobs still hold inputs after 100 ticks")


def put(storage: Storage) -> str:
    key = f"in/{uuid.uuid4()}"
    storage._client.put_object(Bucket=storage.bucket, Key=key, Body=b"a person's file")  # setup
    return key


def put_extra(db: Conn, storage: Storage, user: str) -> str:
    """One more completed upload a job reads beside its main input (a subtitle file, a clip)."""
    key = put(storage)
    db.execute(
        """
        insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                             part_count, expires_at, completed_at, probed_at)
        values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1, now() + interval '1 hour', now(), now())
        """,
        (user, key),
    )
    return key


def left(db: Conn, job: str) -> tuple[str | None, list[str]]:
    """The inputs the job's row still names."""
    row = one(db, "select input_key, extra_input_keys from jobs where id = %s", job)
    return row["input_key"], row["extra_input_keys"]


def marked_deleted(db: Conn, key: str) -> bool:
    row = one(db, "select deleted_at from uploads where storage_key = %s", key)
    return row["deleted_at"] is not None


def ended_job(db: Conn, storage: Storage, status: str = "expired") -> tuple[str, str]:
    """A job that ended with nobody to delete its input: (job, key)."""
    key = put(storage)
    job = new_job(db, new_user(db), key)
    db.execute("update jobs set status = %s, finished_at = now() where id = %s", (status, job))
    return job, key


def ledger(db: Conn, job: str) -> list[str]:
    rows = db.execute(
        "select kind from credit_transactions where job_id = %s order by created_at", (job,)
    ).fetchall()
    return [row["kind"] for row in rows]


def test_a_job_cancelled_while_its_worker_is_dead_loses_its_inputs(
    db: Conn, storage: Storage
) -> None:
    """(a) The web leaves a running job's inputs to its worker; this one's was killed."""
    user = new_user(db)
    key, extra = put(storage), put_extra(db, storage, user)
    job = new_job(db, user, key, extra_input_keys=[extra])
    db.execute(
        """
        update jobs set status = 'running', attempts = 1, worker_id = 'killed-for-memory',
                        started_at = now(), heartbeat_at = now() - interval '20 seconds'
        where id = %s
        """,
        (job,),
    )
    # Before the reaper's minute is up, the person cancels (the web's stopJob).
    db.execute(
        "update jobs set status = 'cancelled', error_code = 'CANCELLED', finished_at = now()"
        " where id = %s",
        (job,),
    )
    tick(db, storage)
    # Heard from 20 s ago: the worker may only be slow, and about to clean up itself.
    assert left(db, job) == (key, [extra])
    assert exists(storage, key)
    assert exists(storage, extra)

    # A minute without a heartbeat: nobody is coming.
    db.execute("update jobs set heartbeat_at = now() - interval '61 seconds' where id = %s", (job,))
    tick(db, storage)
    assert not exists(storage, key)
    assert not exists(storage, extra)
    assert left(db, job) == (None, [])
    assert marked_deleted(db, key)
    assert marked_deleted(db, extra)
    assert one(db, "select status from jobs where id = %s", job)["status"] == "cancelled"


def test_a_job_failed_by_a_tick_that_died_loses_its_input_on_the_next_tick(
    db: Conn, storage: Storage
) -> None:
    """(b) The reaper commits, then the worker is killed (a deploy) before the input goes."""
    user = new_user(db, credits=5)
    key = put(storage)
    job = new_job(db, user, key, quote=2)
    db.execute(
        """
        update jobs set status = 'running', attempts = 3, worker_id = 'gone',
                        heartbeat_at = now() - interval '2 minutes'
        where id = %s
        """,
        (job,),
    )
    # All that tick got done: what it had reaped was only in its memory.
    jobqueue.reap(db)
    row = one(db, "select status, error_code from jobs where id = %s", job)
    assert (row["status"], row["error_code"]) == ("failed", "WORKER_LOST")
    assert exists(storage, key)

    tick(db, storage)
    assert not exists(storage, key)
    assert left(db, job) == (None, [])
    assert marked_deleted(db, key)
    # Its credits came back once, with the reaper; the cleanup touches no money.
    assert ledger(db, job) == ["reserve", "release"]
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 5


def test_a_tick_that_fails_after_the_reaper_doesnt_lose_the_input(
    db: Conn, storage: Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) Cancelling the dead worker's GPU call raises: the same tick never reaches the input."""
    key = put(storage)
    job = new_job(db, new_user(db), key)
    db.execute(
        """
        update jobs set status = 'running', attempts = 3, worker_id = 'gone',
                        heartbeat_at = now() - interval '2 minutes', gpu_rate_usd = 0.0002,
                        gpu_call_at = now() - interval '90 seconds', gpu_call_id = 'fc-lost'
        where id = %s
        """,
        (job,),
    )
    broken = scheduler(storage)

    def modal_is_down(_conn: Conn, _call: jobqueue.StaleCall) -> None:
        raise RuntimeError("the GPU backend didn't answer")

    monkeypatch.setattr(broken, "_cancel_call", modal_is_down)
    with pytest.raises(RuntimeError):
        tick(db, storage, broken)
    assert one(db, "select status from jobs where id = %s", job)["status"] == "failed"

    tick(db, storage)
    assert not exists(storage, key)
    assert left(db, job) == (None, [])


class KilledBeforeCleanup(Storage):
    """Storage as a worker killed right after marking its job finds it: no delete is sent."""

    def __init__(self, inner: Storage) -> None:
        self.__dict__.update(inner.__dict__)

    def delete(self, key: str) -> None:
        raise Killed


@pytest.mark.parametrize("outcome", ["succeeded", "failed"])
def test_a_job_whose_runner_was_killed_after_marking_it_loses_its_input(
    db: Conn, storage: Storage, media: dict[str, Any], outcome: str
) -> None:
    """(c) Between the commit of succeed() or fail() and the ``finally`` that deletes."""
    user = new_user(db, credits=5)
    key = put_input(storage, media["mp4"])
    options = Jsonb({"fail": outcome == "failed"})
    job = new_job(db, user, key, quote=2, options=options)
    run = runner(KilledBeforeCleanup(storage))
    with pytest.raises(Killed):
        run.run(claim_this(db, run, job))
    row = one(db, "select status, input_key, output_key from jobs where id = %s", job)
    assert (row["status"], row["input_key"]) == (outcome, key)
    assert exists(storage, key)

    # Its last heartbeat is seconds old: for all the scheduler knows, it is still cleaning up.
    tick(db, storage)
    assert left(db, job) == (key, [])
    assert exists(storage, key)

    db.execute("update jobs set heartbeat_at = now() - interval '61 seconds' where id = %s", (job,))
    tick(db, storage)
    assert not exists(storage, key)
    assert left(db, job) == (None, [])
    assert marked_deleted(db, key)
    # The job is as its runner left it, and so is the money.
    assert one(db, "select status from jobs where id = %s", job)["status"] == outcome
    assert ledger(db, job) == ["reserve", "capture" if outcome == "succeeded" else "release"]
    if row["output_key"]:
        storage.delete(row["output_key"])


def test_a_job_reaped_for_good_or_expired_loses_its_input_in_the_same_tick(
    db: Conn, storage: Storage
) -> None:
    user = new_user(db, credits=5)
    lost_key, waited_key = put(storage), put(storage)
    lost = new_job(db, user, lost_key, quote=2)
    waited = new_job(db, user, waited_key, quote=1)
    db.execute(
        """
        update jobs set status = 'running', attempts = 3, worker_id = 'gone',
                        heartbeat_at = now() - interval '2 minutes'
        where id = %s
        """,
        (lost,),
    )
    db.execute("update jobs set queued_at = now() - interval '20 minutes' where id = %s", (waited,))
    tick(db, storage)
    assert one(db, "select status from jobs where id = %s", lost)["status"] == "failed"
    assert one(db, "select status from jobs where id = %s", waited)["status"] == "expired"
    for job, key in ((lost, lost_key), (waited, waited_key)):
        assert not exists(storage, key)
        assert left(db, job) == (None, [])
        assert marked_deleted(db, key)
        assert ledger(db, job) == ["reserve", "release"]
    assert one(db, "select credit_balance from users where id = %s", user)["credit_balance"] == 5


@pytest.mark.parametrize("status", ["succeeded", "failed", "cancelled"])
def test_an_ended_job_whose_runner_is_alive_is_left_to_it(
    db: Conn, storage: Storage, status: str
) -> None:
    key = put(storage)
    job = new_job(db, new_user(db), key)
    db.execute(
        """
        update jobs set status = %s, worker_id = 'alive', finished_at = now(),
                        heartbeat_at = now() - interval '10 seconds'
        where id = %s
        """,
        (status, job),
    )
    tick(db, storage)
    assert exists(storage, key)
    assert left(db, job) == (key, [])
    assert not marked_deleted(db, key)
    # (It did clean up.)
    storage.delete(key)
    db.execute("update jobs set input_key = null where id = %s", (job,))


def test_jobs_still_to_run_keep_their_inputs(db: Conn, storage: Storage) -> None:
    user = new_user(db)
    keys = [put(storage) for _ in range(3)]
    waiting, running, stalled = (new_job(db, user, key) for key in keys)
    db.execute(
        "update jobs set status = 'running', attempts = 1, worker_id = 'busy', heartbeat_at = now()"
        " where id = %s",
        (running,),
    )
    # Silent for two minutes on its first attempt: the reaper hands it to another worker.
    db.execute(
        """
        update jobs set status = 'running', attempts = 1, worker_id = 'gone',
                        heartbeat_at = now() - interval '2 minutes'
        where id = %s
        """,
        (stalled,),
    )
    tick(db, storage)
    statuses = [
        one(db, "select status from jobs where id = %s", job)["status"]
        for job in (waiting, running, stalled)
    ]
    assert statuses == ["queued", "running", "queued"]
    for job, key in zip((waiting, running, stalled), keys, strict=True):
        assert exists(storage, key)
        assert left(db, job) == (key, [])
    for job, key in zip((waiting, running, stalled), keys, strict=True):
        storage.delete(key)
        db.execute("update jobs set status = 'cancelled', input_key = null where id = %s", (job,))


def test_a_delete_storage_refuses_is_tried_again_on_the_next_tick(
    db: Conn, storage: Storage
) -> None:
    user = new_user(db)
    keys = [put(storage), put_extra(db, storage, user), put_extra(db, storage, user)]
    job = new_job(db, user, keys[0], extra_input_keys=keys[1:])
    db.execute("update jobs set status = 'cancelled', finished_at = now() where id = %s", (job,))
    tick(db, FlakyDelete(storage, keys[1]))
    # What went is recorded; the one refused, and what came after it, stay on the job.
    assert left(db, job) == (None, keys[1:])
    assert [exists(storage, key) for key in keys] == [False, True, True]
    assert [marked_deleted(db, key) for key in keys] == [True, False, False]

    tick(db, storage)
    assert left(db, job) == (None, [])
    assert not any(exists(storage, key) for key in keys)
    assert all(marked_deleted(db, key) for key in keys)


class Down(Storage):
    """Storage that answers nothing, and counts the deletes it was asked for."""

    def __init__(self, inner: Storage) -> None:
        self.__dict__.update(inner.__dict__)
        self.asked = 0

    def delete(self, key: str) -> None:
        self.asked += 1
        raise StorageError("UNREACHABLE", "delete failed: UNREACHABLE")


def test_with_storage_down_a_tick_asks_once_and_the_next_one_tries_again(
    db: Conn, storage: Storage
) -> None:
    ended = [ended_job(db, storage) for _ in range(3)]
    down = Down(storage)
    tick(db, down)
    # One refusal ends the pass: a timeout for every job would hold up the heartbeat and
    # the reaper, which run in the same loop.
    assert down.asked == 1
    for job, key in ended:
        assert left(db, job) == (key, [])
        assert exists(storage, key)

    tick(db, storage)
    for job, key in ended:
        assert left(db, job) == (None, [])
        assert not exists(storage, key)


def test_a_pass_is_bounded_and_a_second_one_finds_nothing(db: Conn, storage: Storage) -> None:
    ended = [ended_job(db, storage, status) for status in ("succeeded", "failed", "expired")]
    assert len(jobqueue.ended_with_inputs(db, limit=2)) == 2
    assert set(jobqueue.ended_with_inputs(db)) == {job for job, _key in ended}

    tick(db, storage)
    assert jobqueue.ended_with_inputs(db) == []
    for job, key in ended:
        assert left(db, job) == (None, [])
        assert not exists(storage, key)
    tick(db, storage)  # nothing left: the same again changes nothing
    assert jobqueue.ended_with_inputs(db) == []


class Recorded:
    """A connection that keeps the statements run on it."""

    def __init__(self, conn: Conn) -> None:
        self.conn = conn
        self.ran: list[tuple[Any, Any]] = []

    def execute(self, query: Any, params: Any = None) -> Any:
        self.ran.append((query, params))
        return self.conn.execute(query, params)


def plan_of_the_read(db: Conn) -> str:
    """How Postgres runs the tick's read of ended jobs when a scan of the table is its last
    choice (on a test database's few rows it is the first, whatever indexes there are)."""
    recorded = Recorded(db)
    jobqueue.ended_with_inputs(cast("Conn", recorded))
    [(query, params)] = recorded.ran
    with db.transaction():
        db.execute("set local enable_seqscan = off")
        rows = db.execute("explain " + query, params).fetchall()
    return "\n".join(row["QUERY PLAN"] for row in rows)


def test_the_read_of_ended_jobs_goes_by_the_index_of_jobs_that_hold_inputs(db: Conn) -> None:
    """The read runs on every tick, and nearly every row of ``jobs`` is an ended job with
    no input left: without an index it reads them all, each time.

    The index is partial, on the jobs that hold inputs. Postgres uses one only while the
    read's own filter says what the index's does, so a change to either shows up here.
    """
    rows = db.execute(
        "select indexname from pg_indexes"
        " where tablename = 'jobs' and indexdef ~ ' WHERE .*input_key'"
    ).fetchall()
    if not rows:
        pytest.skip("this database has no index on the jobs that hold inputs yet (packages/db)")
    plan = plan_of_the_read(db)
    assert any(row["indexname"] in plan for row in rows), plan


def test_an_input_already_gone_from_storage_is_only_recorded(db: Conn, storage: Storage) -> None:
    job, key = ended_job(db, storage, "cancelled")
    # The sweeper deleted the object when its upload expired; the job still names it.
    storage.delete(key)
    tick(db, storage)
    assert left(db, job) == (None, [])
    assert marked_deleted(db, key)


# The web's retryJob (admin): an ended job runs again while its input is still there.
RETRY = """
    update jobs
    set status = 'queued', attempts = 0, worker_id = null, heartbeat_at = null,
        finished_at = null, queued_at = now()
    where id = %s and status in ('failed', 'cancelled', 'expired') and input_key is not null
      and exists (
        select 1 from uploads u where u.storage_key = jobs.input_key and u.deleted_at is null
      )
"""


def test_a_job_queued_again_before_its_turn_keeps_its_input(db: Conn, storage: Storage) -> None:
    job, key = ended_job(db, storage, "failed")
    assert jobqueue.ended_with_inputs(db) == [job]
    # An admin retries it after the tick read the rows, before the tick got to this job.
    assert db.execute(RETRY, (job,)).rowcount == 1
    assert scheduler(storage)._drop_input(db, storage, job)
    assert exists(storage, key)
    assert left(db, job) == (key, [])
    assert not marked_deleted(db, key)
    db.execute("update jobs set status = 'cancelled' where id = %s", (job,))
    tick(db, storage)
    assert not exists(storage, key)


class RetriedMidDelete(Storage):
    """Storage during whose delete an admin retries the job, on a connection of their own."""

    def __init__(self, inner: Storage, job: str) -> None:
        self.__dict__.update(inner.__dict__)
        self.job = job
        self.retried: list[int] = []
        self.retry = threading.Thread(target=self._retry)

    def _retry(self) -> None:
        with connect_url(URL) as conn:
            self.retried.append(conn.execute(RETRY, (self.job,)).rowcount)

    def delete(self, key: str) -> None:
        self.retry.start()
        self.retry.join(0.5)
        # The row is locked while its input goes: the retry waits for the outcome.
        assert self.retry.is_alive()
        super().delete(key)


def test_a_retry_that_arrives_while_the_input_goes_waits_and_is_refused(
    db: Conn, storage: Storage
) -> None:
    """Never a queued job without its input: the retry comes first, or finds the input gone."""
    job, key = ended_job(db, storage, "failed")
    retried = RetriedMidDelete(storage, job)
    tick(db, retried)
    retried.retry.join(10)
    assert retried.retried == [0]
    assert one(db, "select status from jobs where id = %s", job)["status"] == "failed"
    assert left(db, job) == (None, [])
    assert not exists(storage, key)


def test_a_job_whose_row_someone_holds_is_left_for_the_next_tick(
    db: Conn, storage: Storage
) -> None:
    """The heartbeat and the reaper share the scheduler's loop: it never waits on a row lock."""
    job, key = ended_job(db, storage, "cancelled")
    with connect_url(URL) as other, other.transaction():
        other.execute("select 1 from jobs where id = %s for update", (job,))
        ticking = threading.Thread(target=tick, args=(db, storage), daemon=True)
        ticking.start()
        ticking.join(10)
        assert not ticking.is_alive(), "the tick waits for the lock"
        assert exists(storage, key)
    assert left(db, job) == (key, [])

    tick(db, storage)
    assert not exists(storage, key)
    assert left(db, job) == (None, [])

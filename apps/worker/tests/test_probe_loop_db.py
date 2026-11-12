"""The probe loop against real Postgres 18, storage and ffprobe (finding W3).

Runs like test_jobs_db.py: when TEST_DATABASE_URL is set and storage answers
at TEST_S3_ENDPOINT. test_slots.py covers the loop itself; this is the whole
path: the worker's threads as main.py starts them, a real upload, a real probe.
"""

from __future__ import annotations

import threading
import time
from typing import Any, cast

import pytest

from etb_worker import slots
from etb_worker.db import Conn
from etb_worker.main import slot_threads
from etb_worker.runner import JobRunner
from etb_worker.settings import Settings
from etb_worker.storage import Storage
from tests import test_jobs_db as jobs_db
from tests.test_jobs_db import new_user, one, put_input
from tests.test_slots import InAJob

# The same needs and the same fixtures as the queue's own tests.
pytestmark = jobs_db.pytestmark
db = jobs_db.db
storage = jobs_db.storage


def test_an_upload_is_probed_while_the_only_cpu_slot_is_inside_a_job(
    db: Conn, storage: Storage, media: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(slots, "POLL_SEC", 0.05)
    stop, wake, release = threading.Event(), threading.Event(), threading.Event()
    busy = InAJob(release)
    threads = slot_threads(Settings(), storage, [cast(JobRunner, busy)], wake, stop)
    for thread in threads:
        thread.start()
    key = None
    try:
        # The slot is in its job (a two-hour compress, as far as the worker can tell).
        assert busy.started.wait(60)
        key = put_input(storage, media["mp4"])
        upload = one(
            db,
            """
            insert into uploads (user_id, storage_key, bytes, mime_claimed, tool_id, part_size,
                                 part_count, expires_at, completed_at)
            values (%s, %s, 1, 'video/mp4', 'test-remux', 1, 1, now() + interval '1 hour', now())
            returning id
            """,
            new_user(db),
            key,
        )["id"]
        wake.set()  # NOTIFY etb_uploads
        deadline = time.monotonic() + 30
        while one(db, "select probed_at from uploads where id = %s", upload)["probed_at"] is None:
            assert time.monotonic() < deadline, "the upload waits for the job to end"
            time.sleep(0.1)
        assert busy.runs == 1  # the slot never came back from its job to do it
    finally:
        stop.set()
        release.set()
        wake.set()
        for thread in threads:
            thread.join(30)
        if key is not None:
            storage.delete(key)
    assert not any(thread.is_alive() for thread in threads)
    probed = one(db, "select probe, probe_error from uploads where id = %s", upload)
    assert probed["probe_error"] is None
    assert probed["probe"]["video"]["width"] == 160
    db.execute("update uploads set deleted_at = now() where id = %s", (upload,))

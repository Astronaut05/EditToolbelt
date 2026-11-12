"""The limits every worker connection carries (db.py), against a real Postgres 18.

Runs when TEST_DATABASE_URL is set. A statement, a lock held by someone else
or a host that vanished must end in an error the caller's loop survives, never
in a wait without end: the scheduler's tick holds the leader lock meanwhile,
and a job's heartbeat thread would go quiet.
"""

from __future__ import annotations

import os
import socket
import time
import uuid
from datetime import timedelta

import psycopg
import pytest

from etb_worker.db import connect_url, long_statements
from etb_worker.ledger import apply_credit

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

SHORT = timedelta(milliseconds=300)


def test_every_connection_has_a_statement_and_a_lock_timeout() -> None:
    with connect_url(URL) as conn:
        row = conn.execute(
            "select current_setting('statement_timeout') as statement,"
            " current_setting('lock_timeout') as lock"
        ).fetchone()
    assert row == {"statement": "30s", "lock": "5s"}


def test_a_statement_past_the_timeout_raises_instead_of_hanging() -> None:
    with connect_url(URL, statement_timeout=SHORT) as conn:
        started = time.monotonic()
        with pytest.raises(psycopg.errors.QueryCanceled):
            conn.execute("select pg_sleep(10)")
        assert time.monotonic() - started < 5
        # Only the statement ended: the connection goes on.
        assert conn.execute("select 1 as one").fetchone() == {"one": 1}


def test_a_row_someone_else_holds_fails_the_credit_instead_of_waiting() -> None:
    with connect_url(URL) as holder, connect_url(URL, lock_timeout=SHORT) as waiter:
        row = holder.execute(
            "insert into users (email) values (%s) returning id::text as id",
            (f"{uuid.uuid4().hex[:12]}@example.test",),
        ).fetchone()
        assert row is not None
        user = row["id"]
        with holder.transaction():
            holder.execute("select 1 from users where id = %s for update", (user,))
            started = time.monotonic()
            with pytest.raises(psycopg.errors.LockNotAvailable):
                apply_credit(waiter, user, "release", 5, job_id=str(uuid.uuid4()))
            assert time.monotonic() - started < 5
        # Nothing was half done: no ledger row, the balance as it was.
        left = holder.execute(
            "select u.credit_balance, count(t.id)::int as ledger_rows from users u"
            " left join credit_transactions t on t.user_id = u.id where u.id = %s group by u.id",
            (user,),
        ).fetchone()
        assert left == {"credit_balance": 0, "ledger_rows": 0}
        # And once the row is free, the same call goes through (the ledger is append-only,
        # so the row stays: the user's balance equals it).
        assert apply_credit(waiter, user, "release", 5, job_id=str(uuid.uuid4())) == 5


def test_an_advisory_lock_someone_else_holds_fails_the_wait_too() -> None:
    key = uuid.uuid4().int % 2**31
    with (
        connect_url(URL) as holder,
        connect_url(URL, lock_timeout=SHORT) as waiter,
        holder.transaction(),
    ):
        holder.execute("select pg_advisory_xact_lock(%s)", (key,))
        with pytest.raises(psycopg.errors.LockNotAvailable), waiter.transaction():
            waiter.execute("select pg_advisory_xact_lock(%s)", (key,))


@pytest.mark.skipif(not hasattr(socket, "TCP_USER_TIMEOUT"), reason="Linux socket options")
def test_a_host_that_vanished_is_noticed_within_a_minute() -> None:
    """Without these the kernel waits 2 hours for an answer, or 15 minutes for an ACK."""
    with connect_url(URL) as conn:
        sock = socket.socket(fileno=os.dup(conn.pgconn.socket))
        try:
            if sock.family == socket.AF_UNIX:
                pytest.skip("a Unix socket has no host to lose")
            assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE) == 1
            options = {
                name: sock.getsockopt(socket.IPPROTO_TCP, getattr(socket, name))
                for name in ("TCP_KEEPIDLE", "TCP_KEEPINTVL", "TCP_KEEPCNT", "TCP_USER_TIMEOUT")
            }
        finally:
            sock.close()
    assert options == {
        "TCP_KEEPIDLE": 30,
        "TCP_KEEPINTVL": 10,
        "TCP_KEEPCNT": 3,
        "TCP_USER_TIMEOUT": 60_000,
    }


def test_settings_the_url_carries_are_kept() -> None:
    joiner = "&" if "?" in URL else "?"
    with connect_url(f"{URL}{joiner}options=-c%20work_mem%3D5MB") as conn:
        row = conn.execute(
            "select current_setting('work_mem') as work_mem,"
            " current_setting('statement_timeout') as statement"
        ).fetchone()
    assert row == {"work_mem": "5MB", "statement": "30s"}


def test_the_nightly_jobs_get_longer_for_a_statement_and_only_they_do() -> None:
    with connect_url(URL, statement_timeout=SHORT) as conn:
        with long_statements(conn, timedelta(seconds=30)):
            conn.execute("select pg_sleep(0.6)")  # twice the connection's own limit
        with pytest.raises(psycopg.errors.QueryCanceled):
            conn.execute("select pg_sleep(0.6)")
        # A statement that ran out of time inside leaves the connection's own limit behind too.
        with pytest.raises(psycopg.errors.QueryCanceled), long_statements(conn, SHORT):
            conn.execute("select pg_sleep(10)")
        assert conn.execute("show statement_timeout").fetchone() == {"statement_timeout": "300ms"}

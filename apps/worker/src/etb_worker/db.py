"""Postgres connections for the worker: short-lived, autocommit, rows as dicts.

Every connection carries limits, so nothing waits without end: a statement
that runs away, a lock someone else holds, a host that vanished. A wait in
the scheduler's tick keeps the leader lock, so no worker reaps, expires,
sweeps or alerts meanwhile; a wait in a job's heartbeat thread gets the job
reaped and run again while the first run carries on. A limit that is hit
raises a ``psycopg.Error``, which every loop in the worker already survives.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from etb_worker.settings import Settings

Conn = psycopg.Connection[dict[str, Any]]

#: The longest one statement may run. What a tick or a job runs takes milliseconds.
STATEMENT_TIMEOUT = timedelta(seconds=30)
#: The longest a statement may wait for a lock someone else holds (a row, an advisory lock).
LOCK_TIMEOUT = timedelta(seconds=5)
#: For the once-a-day jobs (``long_statements``), which read whole tables: the ledger
#: check sums every ledger row ever written, and the ledger only grows.
NIGHTLY_STATEMENT_TIMEOUT = timedelta(minutes=5)


def connect(settings: Settings) -> Conn:
    return connect_url(settings.database_url.get_secret_value())


def connect_url(
    url: str,
    *,
    statement_timeout: timedelta = STATEMENT_TIMEOUT,
    lock_timeout: timedelta = LOCK_TIMEOUT,
) -> Conn:
    # After any options the URL carries itself, so those stay and these two win.
    options = (
        f"{conninfo_to_dict(url).get('options') or ''}"
        f" -c statement_timeout={_ms(statement_timeout)} -c lock_timeout={_ms(lock_timeout)}"
    )
    return psycopg.connect(
        url,
        autocommit=True,
        connect_timeout=5,
        application_name="etb-worker",
        row_factory=dict_row,
        options=options.strip(),
        # A host that vanished: probed after 30 s of silence, every 10 s, given up after 3
        # (a minute in all; the kernel's own default is 2 hours).
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
        # Probes only start on a quiet line. A statement sent and never acknowledged is
        # resent for some 15 minutes instead; this ends that after a minute too.
        tcp_user_timeout=60_000,
    )


def _ms(timeout: timedelta) -> int:
    return int(timeout / timedelta(milliseconds=1))


@contextlib.contextmanager
def long_statements(conn: Conn, timeout: timedelta = NIGHTLY_STATEMENT_TIMEOUT) -> Iterator[None]:
    """Inside, a statement on ``conn`` may run up to ``timeout``; after, its own limit again.

    For the once-a-day jobs only. The lock timeout stays as it is: they read
    for long, they never wait for long.
    """
    conn.execute("select set_config('statement_timeout', %s, false)", (str(_ms(timeout)),))
    try:
        yield
    finally:
        # A connection that broke inside can't be reset, and has no limit left to restore.
        with contextlib.suppress(psycopg.Error):
            conn.execute("reset statement_timeout")


def record_check(conn: Conn, name: str, *, ok: bool, detail: dict[str, Any]) -> None:
    """Store the latest result of a scheduled check (the admin's System page lists them)."""
    conn.execute(
        """
        insert into system_checks (name, ok, detail, ran_at)
        values (%s, %s, %s, now())
        on conflict (name) do update
          set ok = excluded.ok, detail = excluded.detail, ran_at = excluded.ran_at
        """,
        (name, ok, Jsonb(detail)),
    )

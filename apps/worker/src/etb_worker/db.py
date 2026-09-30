"""Postgres connections for the scheduler: short-lived, autocommit, rows as dicts."""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from etb_worker.settings import Settings

Conn = psycopg.Connection[dict[str, Any]]


def connect(settings: Settings) -> Conn:
    return connect_url(settings.database_url.get_secret_value())


def connect_url(url: str) -> Conn:
    return psycopg.connect(
        url,
        autocommit=True,
        connect_timeout=5,
        application_name="etb-worker",
        row_factory=dict_row,
    )


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

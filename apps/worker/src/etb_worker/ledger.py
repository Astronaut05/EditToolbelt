"""The credit ledger, as the worker uses it (docs/05 -> Reserve, capture, release).

Mirrors ``applyCredit`` in packages/db/src/credits.ts: lock the user row,
append one ledger row, move the cached balance, all in one transaction
(a savepoint inside the caller's). The worker only ever releases a job's
reserve (failure, expiry, a lost worker) or captures it (a 0-credit marker on
success); the web reserves when it creates the job. The nightly ledger
check proves both sides keep the balance equal to the sum of the rows.
"""

from __future__ import annotations

from typing import Literal

from etb_worker.db import Conn

Kind = Literal["capture", "release"]


def apply_credit(conn: Conn, user_id: str, kind: Kind, amount: int, *, job_id: str) -> int:
    """Appends one row for ``job_id``; returns the balance after it."""
    with conn.transaction():
        row = conn.execute(
            "select credit_balance from users where id = %s for update", (user_id,)
        ).fetchone()
        if row is None:
            msg = "no such user"
            raise LookupError(msg)
        balance_after = int(row["credit_balance"]) + amount
        conn.execute(
            """
            insert into credit_transactions (user_id, kind, amount, balance_after, job_id)
            values (%s, %s, %s, %s, %s)
            """,
            (user_id, kind, amount, balance_after, job_id),
        )
        conn.execute("update users set credit_balance = %s where id = %s", (balance_after, user_id))
    return balance_after


def release(conn: Conn, job: dict[str, object]) -> None:
    """Gives a failed, expired or abandoned job's reserve back ("Credits returned")."""
    quoted = int(str(job.get("credits_quoted") or 0))
    if quoted > 0:
        apply_credit(conn, str(job["user_id"]), "release", quoted, job_id=str(job["id"]))


def capture(conn: Conn, job: dict[str, object]) -> None:
    """Marks a finished job's reserve as spent (a 0-credit row)."""
    if int(str(job.get("credits_quoted") or 0)) > 0:
        apply_credit(conn, str(job["user_id"]), "capture", 0, job_id=str(job["id"]))

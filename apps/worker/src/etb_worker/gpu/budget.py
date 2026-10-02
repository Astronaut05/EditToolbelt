"""The daily GPU budget (docs/05 -> GPU costs and the daily budget).

An admin sets a budget in dollars a day (Admin, Dashboard; the ``gpu_budget``
row, $1 until changed). Two sums over every GPU job started since 00:00 UTC:

- **Spent**: the recorded cost of its calls, plus the call in flight's time
  so far at the job's rate. This is what the admin reads and what the 80 %
  and 100 % alerts watch.
- **Committed**: the recorded cost, plus every running GPU job at its worst
  case: its whole time limit (``timeout_sec``, past which the worker cancels
  the call) and the longest idle window, at its rate. This is what the gate
  reads.

- The gate: a GPU job may start only while committed < budget, checked in
  the claim's own transaction under an advisory lock (jobqueue.claim_gpu), so
  claims are serialised across every slot and worker. Spend can then pass
  the budget by at most one job's worst case, and only when every running
  job really does run to its limit. Queued GPU jobs wait; any that wait 15
  minutes expire with their credits back (jobqueue.expire). CPU jobs carry
  on. A running job finishing, a raised budget, or midnight UTC opens it.
- At 80 % and at 100 % of spent an alert goes out, once a day each (the
  alerts module: Telegram, else email).

The spend errs high: a call's cost includes the GPU's idle window after it,
and a call that couldn't say what it used counts its wall-clock time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from etb_worker.alerts import Alert
from etb_worker.db import Conn
from etb_worker.gpu import MAX_IDLE_TAIL_SEC

#: The column default; the migration also writes the row.
DEFAULT_DAILY_USD = 1.0
WARN_AT = 0.8
#: Any constant works; it only has to be the same in every worker (the scheduler's is 0x45544253).
CLAIM_LOCK = 0x45544247


@dataclass(frozen=True)
class BudgetState:
    day: date
    spent_usd: float
    budget_usd: float
    #: Spent, with every running GPU job at its worst case instead of its time so far.
    committed_usd: float = 0.0

    @property
    def share(self) -> float:
        if self.budget_usd <= 0:
            return 1.0 if self.spent_usd > 0 else 0.0
        return self.spent_usd / self.budget_usd

    @property
    def open(self) -> bool:
        """Another GPU job may start: even if every running one ran to its limit, we'd be under."""
        return self.committed_usd < self.budget_usd


def state(conn: Conn) -> BudgetState:
    row = conn.execute(
        """
        select (now() at time zone 'UTC')::date as day,
               coalesce((select daily_usd from gpu_budget where id = 1), %(default)s)::float8
                 as budget,
               coalesce(sum(coalesce(gpu_cost_usd, 0) + case
                   when status = 'running' and gpu_call_at is not null
                     then greatest(extract(epoch from now() - gpu_call_at), 0) * gpu_rate_usd
                   else 0 end), 0)::float8 as spent,
               coalesce(sum(coalesce(gpu_cost_usd, 0) + case
                   when status = 'running' then (timeout_sec + %(tail)s) * gpu_rate_usd
                   else 0 end), 0)::float8 as committed
        from jobs
        where gpu_rate_usd is not null
          and started_at >= date_trunc('day', now(), 'UTC')
        """,
        {"default": DEFAULT_DAILY_USD, "tail": MAX_IDLE_TAIL_SEC},
    ).fetchone()
    if row is None:  # pragma: no cover - an aggregate always answers
        return BudgetState(date.today(), 0.0, DEFAULT_DAILY_USD)  # noqa: DTZ011
    return BudgetState(
        day=row["day"],
        spent_usd=float(row["spent"]),
        budget_usd=float(row["budget"]),
        committed_usd=float(row["committed"]),
    )


def gpu_open(conn: Conn) -> bool:
    return state(conn).open


def _sent(conn: Conn, subject: str) -> bool:
    row = conn.execute(
        "select 1 from alerts where rule = 'gpu_budget' and subject = %s limit 1", (subject,)
    ).fetchone()
    return row is not None


def budget_alerts(conn: Conn) -> list[Alert]:
    """80 % and 100 % of today's budget, each once a day (the subject carries the day)."""
    now = state(conn)
    spent, budget = f"${now.spent_usd:.2f}", f"${now.budget_usd:.2f}"
    if now.share >= 1:
        subject = f"{now.day.isoformat()}/100"
        message = (
            f"GPU budget reached: {spent} of {budget} today (UTC). New GPU jobs wait in the "
            "queue until midnight UTC or until the budget is raised in Admin; any that wait "
            "15 min expire with their credits back."
        )
    elif now.share >= WARN_AT:
        subject = f"{now.day.isoformat()}/80"
        message = (
            f"GPU spend is {spent} of today's {budget} budget ({round(now.share * 100)} %). "
            "GPU jobs stop starting at 100 %."
        )
    else:
        return []
    if _sent(conn, subject):
        return []
    return [Alert("gpu_budget", subject, message)]

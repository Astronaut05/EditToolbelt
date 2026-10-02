"""The daily GPU budget (docs/05 -> GPU costs and the daily budget).

An admin sets a budget in dollars a day (Admin, Dashboard; the ``gpu_budget``
row, $1 until changed). Today's spend is every GPU job's cost since 00:00
UTC: the recorded cost of its calls, or for a call still running the time so
far at the job's rate, so a burst of long jobs counts before it ends.

- At 100 % the worker stops claiming GPU jobs: they wait in the queue, and
  any that wait 15 minutes expire with their credits back (jobqueue.expire).
  Other jobs carry on. Raising the budget, or midnight UTC, opens it again.
- At 80 % and at 100 % an alert goes out, once a day each (the alerts module:
  Telegram, else email).

The spend errs high: a call's cost includes the GPU's idle window after it,
and a running call is charged from when its job started, queueing included.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from etb_worker.alerts import Alert
from etb_worker.db import Conn

#: The column default; the migration also writes the row.
DEFAULT_DAILY_USD = 1.0
WARN_AT = 0.8


@dataclass(frozen=True)
class BudgetState:
    day: date
    spent_usd: float
    budget_usd: float

    @property
    def share(self) -> float:
        if self.budget_usd <= 0:
            return 1.0 if self.spent_usd > 0 else 0.0
        return self.spent_usd / self.budget_usd

    @property
    def open(self) -> bool:
        """GPU jobs may start: today's spend is under the budget."""
        return self.spent_usd < self.budget_usd


def state(conn: Conn) -> BudgetState:
    row = conn.execute(
        """
        select (now() at time zone 'UTC')::date as day,
               coalesce((select daily_usd from gpu_budget where id = 1), %s)::float8 as budget,
               coalesce((
                 select sum(case
                   when gpu_cost_usd is not null then gpu_cost_usd
                   when status = 'running' and started_at is not null
                     then extract(epoch from now() - started_at) * gpu_rate_usd
                   else 0 end)
                 from jobs
                 where gpu_rate_usd is not null
                   and started_at >= date_trunc('day', now(), 'UTC')
               ), 0)::float8 as spent
        """,
        (DEFAULT_DAILY_USD,),
    ).fetchone()
    if row is None:  # pragma: no cover - a select always answers
        return BudgetState(date.today(), 0.0, DEFAULT_DAILY_USD)  # noqa: DTZ011
    return BudgetState(
        day=row["day"], spent_usd=float(row["spent"]), budget_usd=float(row["budget"])
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

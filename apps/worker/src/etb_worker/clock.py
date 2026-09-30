"""Dates and times for the scheduler.

Daily jobs and the digest follow the operator's day in Tashkent (docs/07 ->
Alerts: "daily digest at 09:00 Asia/Tashkent"). Tashkent is UTC+5 all year
with no daylight saving (since 1992), so a fixed offset is exact and needs no
time-zone database in the slim worker image.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone

TASHKENT = timezone(timedelta(hours=5), "Asia/Tashkent")


def local(moment: datetime) -> datetime:
    """``moment`` (time-zone aware) in Tashkent."""
    return moment.astimezone(TASHKENT)


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """Start (inclusive) and end (exclusive) of a Tashkent calendar day, in UTC."""
    start = datetime.combine(day, time(0, 0), tzinfo=TASHKENT)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


def is_daily_due(last_run: datetime | None, now: datetime, at: time) -> bool:
    """A once-a-day job runs at ``at`` Tashkent time, or as soon as the worker is up after it.

    Due when it has never run, or when it last ran on an earlier Tashkent day
    and today's ``at`` has passed. Restarts don't repeat it; a worker that was
    down at ``at`` catches up when it starts.
    """
    if last_run is None:
        return True
    today = local(now)
    return local(last_run).date() < today.date() and today.time() >= at

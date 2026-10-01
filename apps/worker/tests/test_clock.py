from __future__ import annotations

from datetime import UTC, date, datetime, time

from etb_worker.clock import day_bounds, is_daily_due, local

AT = time(9, 0)


def utc(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


def test_a_tashkent_day_is_19_00_to_19_00_utc() -> None:
    start, end = day_bounds(date(2026, 9, 29))
    assert start == utc(2026, 9, 28, 19, 0)
    assert end == utc(2026, 9, 29, 19, 0)
    assert local(utc(2026, 9, 28, 19, 0)).date() == date(2026, 9, 29)


def test_due_when_it_never_ran() -> None:
    assert is_daily_due(None, utc(2026, 9, 30, 0, 0), AT)


def test_due_after_the_time_on_a_new_day() -> None:
    last = utc(2026, 9, 29, 4, 0)  # 09:00 Tashkent yesterday
    assert not is_daily_due(last, utc(2026, 9, 30, 3, 59), AT)  # 08:59 Tashkent
    assert is_daily_due(last, utc(2026, 9, 30, 4, 0), AT)  # 09:00 Tashkent


def test_not_due_twice_on_the_same_day() -> None:
    last = utc(2026, 9, 30, 4, 0)
    assert not is_daily_due(last, utc(2026, 9, 30, 18, 59), AT)  # 23:59 Tashkent


def test_a_worker_that_was_down_catches_up() -> None:
    last = utc(2026, 9, 27, 4, 0)
    assert is_daily_due(last, utc(2026, 9, 30, 10, 0), AT)


def test_the_day_turns_at_midnight_tashkent_not_utc() -> None:
    # Ran at 23:30 Tashkent (18:30 UTC); at 00:30 Tashkent it's a new day, same UTC day.
    last = utc(2026, 9, 29, 18, 30)
    assert is_daily_due(last, utc(2026, 9, 29, 19, 30), time(0, 0))

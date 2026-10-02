"""The scheduler against a real Postgres 18 with the migrations applied.

Runs when TEST_DATABASE_URL is set (a throwaway database, never DATABASE_URL);
CI's worker job migrates one first. Rows use random ids and far-past days so
reruns and other tests don't collide.
"""

from __future__ import annotations

import os
import random
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from etb_worker.alerts import (
    Alert,
    fiscal_receipts_unsent,
    queue_wait,
    raise_alert,
    stale_heartbeats,
    tool_failure_rates,
    webhook_errors,
)
from etb_worker.clock import day_bounds
from etb_worker.db import Conn, connect_url
from etb_worker.notify import Notifier
from etb_worker.scheduler import DAILY, LOCK_KEY, Scheduler
from etb_worker.settings import Settings
from etb_worker.tasks import (
    TaskContext,
    account_scrub,
    digest_stats,
    format_digest,
    ledger_check,
    retention_purge,
    tool_stats,
)

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


class Outbox:
    """A notifier whose Telegram channel records messages instead of sending them."""

    def __init__(self, settings: Settings) -> None:
        self.sent: list[tuple[str, str]] = []

        def record(_: Settings, text: str) -> None:
            self.sent.append(("telegram", text))

        configured = settings.model_copy(
            update={"telegram_bot_token": "x", "telegram_chat_id": "-1"}
        )
        self.notifier = Notifier(configured, telegram=record)


@pytest.fixture
def db() -> Iterator[Conn]:
    with connect_url(URL) as conn:
        yield conn


@pytest.fixture
def outbox(settings: Settings) -> Outbox:
    return Outbox(settings)


def ctx(outbox: Outbox) -> TaskContext:
    return TaskContext(notifier=outbox.notifier, now=datetime.now(UTC))


def new_user(db: Conn, **values: Any) -> str:
    values.setdefault("email", f"{uuid.uuid4().hex[:12]}@example.test")
    columns = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    row = db.execute(
        f"insert into users ({columns}) values ({marks}) returning id",  # noqa: S608  # test-only, fixed names
        tuple(values.values()),
    ).fetchone()
    assert row is not None
    return str(row["id"])


def one(db: Conn, query: str, *params: Any) -> dict[str, Any]:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row


def test_heartbeat_is_written_and_removed_on_a_clean_stop(settings: Settings) -> None:
    instance = f"test-{uuid.uuid4().hex[:8]}"
    scheduler = Scheduler(
        settings, Outbox(settings).notifier, instance=instance, connect=lambda _: connect_url(URL)
    )
    with connect_url(URL) as db:
        scheduler.beat(db)
        row = one(db, "select version from service_heartbeats where instance = %s", instance)
        assert row["version"] == settings.app_version
        scheduler.leave()
        gone = db.execute("select 1 from service_heartbeats where instance = %s", (instance,))
        assert gone.fetchone() is None


def test_a_missing_heartbeat_alerts_once_per_30_minutes(db: Conn, outbox: Outbox) -> None:
    instance = f"gpu-{uuid.uuid4().hex[:8]}"
    db.execute(
        "insert into service_heartbeats (service, instance, version, seen_at)"
        " values ('gpu', %s, 'test', now() - interval '5 minutes')",
        (instance,),
    )
    try:
        [alert] = [a for a in stale_heartbeats(db) if a.subject == f"gpu/{instance}"]
        assert alert.message == f"gpu {instance} last checked in 5 min ago."
        assert raise_alert(db, alert, outbox.notifier)
        assert not raise_alert(db, alert, outbox.notifier)  # cooling down
        assert outbox.sent == [("telegram", f"Alert: {alert.message}")]
        row = one(db, "select channels from alerts where subject = %s", f"gpu/{instance}")
        assert row["channels"] == ["telegram"]
    finally:
        db.execute("delete from service_heartbeats where instance = %s", (instance,))


def test_immediate_alerts_skip_the_cool_down(db: Conn, outbox: Outbox) -> None:
    alert = Alert("test_immediate", uuid.uuid4().hex, "now", immediate=True)
    assert raise_alert(db, alert, outbox.notifier)
    assert raise_alert(db, alert, outbox.notifier)
    assert len(outbox.sent) == 2


def webhook_event(db: Conn, error: str | None, age: timedelta = timedelta(0)) -> str:
    """A Paddle event processed ``age`` ago, with ``error``."""
    row = db.execute(
        "insert into webhook_events (provider, event_id, type, payload, processed_at, error)"
        " values ('paddle', %s, 'transaction.paid', '{}'::jsonb, now() - %s, %s)"
        " returning id::text as id",
        (f"evt_{uuid.uuid4().hex}", age, error),
    ).fetchone()
    assert row is not None
    return str(row["id"])


def test_a_webhook_error_alerts_at_once_and_once_per_event(db: Conn, outbox: Outbox) -> None:
    failed = webhook_event(db, "not credited: the transaction total is 400, not 500")
    second = webhook_event(db, "no purchase has this transaction")
    clean = webhook_event(db, None)
    old = webhook_event(db, "paid after the purchase was cancelled", timedelta(days=4))
    found = {alert.subject: alert for alert in webhook_errors(db)}
    assert failed in found
    assert second in found
    assert clean not in found
    assert old not in found
    alert = found[failed]
    assert alert.immediate
    assert alert.rule == "webhook_error"
    assert alert.message == (
        "Payment webhook error: paddle transaction.paid: "
        "not credited: the transaction total is 400, not 500. "
        "See Admin, Payments, Webhook events."
    )
    # Two errors in a row both go out: no cool-down between events.
    assert raise_alert(db, alert, outbox.notifier)
    assert raise_alert(db, found[second], outbox.notifier)
    assert len(outbox.sent) == 2
    # Alerted once: a provider's retry that fails the same way doesn't alert again.
    db.execute("update webhook_events set processed_at = now() where id = %s", (failed,))
    subjects = {alert.subject for alert in webhook_errors(db)}
    assert failed not in subjects
    assert second not in subjects


def test_the_scheduler_raises_webhook_errors(settings: Settings, db: Conn) -> None:
    outbox = Outbox(settings)
    scheduler = Scheduler(
        settings,
        outbox.notifier,
        instance=f"test-{uuid.uuid4().hex[:8]}",
        connect=lambda _: connect_url(URL),
    )
    event = webhook_event(db, "Error: database is down")
    scheduler.check_alerts(db)
    scheduler.check_alerts(db)
    mine = [text for _, text in outbox.sent if "Error: database is down" in text]
    assert len(mine) == 1
    row = one(
        db,
        "select count(*)::int as n from alerts where rule = 'webhook_error' and subject = %s",
        event,
    )
    assert row["n"] == 1


def fiscal_receipt(
    db: Conn, *, status: str, attempts: int, age: timedelta, error: str | None = None
) -> str:
    """A Click purchase, completed, and its fiscal receipt in the given state."""
    user = new_user(db)
    purchase = one(
        db,
        "insert into purchases (user_id, provider, pack_id, credits, amount_minor, currency,"
        " status) values (%s, 'click', 'starter', 200, 6300000, 'UZS', 'completed')"
        " returning id",
        user,
    )["id"]
    row = one(
        db,
        "insert into fiscal_receipts (purchase_id, payment_id, status, attempts, last_error,"
        " created_at) values (%s, %s, %s, %s, %s, now() - %s) returning id::text as id",
        purchase,
        str(uuid.uuid4().int % 10**9 + 1),
        status,
        attempts,
        error,
        age,
    )
    return str(row["id"])


def test_an_unsent_fiscal_receipt_alerts_once(db: Conn, outbox: Outbox) -> None:
    tried = fiscal_receipt(
        db,
        status="failed",
        attempts=6,
        age=timedelta(minutes=31),
        error="Click refused it: -5 Payment not found",
    )
    stuck = fiscal_receipt(db, status="pending", attempts=0, age=timedelta(minutes=61))
    young = fiscal_receipt(db, status="failed", attempts=3, age=timedelta(minutes=7))
    sent = fiscal_receipt(db, status="sent", attempts=9, age=timedelta(hours=5))
    found = {alert.subject: alert for alert in fiscal_receipts_unsent(db)}
    assert tried in found
    assert stuck in found
    assert young not in found
    assert sent not in found
    alert = found[tried]
    assert alert.immediate
    assert alert.rule == "fiscal_receipt_unsent"
    assert alert.message.startswith("Click fiscal receipt not sent: purchase ")
    assert alert.message.endswith(
        ", 6 tries, last error: Click refused it: -5 Payment not found. "
        "Retries carry on; see Admin, Payments."
    )
    assert found[stuck].message.endswith(", 0 tries. Retries carry on; see Admin, Payments.")
    assert raise_alert(db, alert, outbox.notifier)
    assert raise_alert(db, found[stuck], outbox.notifier)
    assert len(outbox.sent) == 2
    # Once per receipt: still unsent on the next check, it doesn't page again.
    subjects = {alert.subject for alert in fiscal_receipts_unsent(db)}
    assert tried not in subjects
    assert stuck not in subjects


def test_a_ledger_mismatch_is_recorded_and_alerts(db: Conn, outbox: Outbox) -> None:
    user = new_user(db, credit_balance=5)  # a balance with no ledger rows behind it
    try:
        ledger_check(db, ctx(outbox))
        check = one(db, "select ok, detail from system_checks where name = 'ledger_invariant'")
        assert check["ok"] is False
        assert check["detail"]["mismatches"] >= 1
        assert any("Ledger check:" in text for _, text in outbox.sent)
    finally:
        db.execute("update users set credit_balance = 0 where id = %s", (user,))
    ledger_check(db, ctx(outbox))
    assert one(db, "select ok from system_checks where name = 'ledger_invariant'")["ok"]


def test_deleted_accounts_become_tombstones_after_30_days(db: Conn, outbox: Outbox) -> None:
    old = new_user(db, display_name="Old", deleted_at=datetime.now(UTC) - timedelta(days=31))
    recent = new_user(db, display_name="Recent", deleted_at=datetime.now(UTC) - timedelta(days=29))
    for user in (old, recent):
        db.execute(
            "insert into sessions (token, user_id, expires_at)"
            " values (%s, %s, now() + interval '1 day')",
            (uuid.uuid4().hex, user),
        )
        db.execute(
            "insert into accounts (account_id, provider_id, user_id) values (%s, 'google', %s)",
            (uuid.uuid4().hex, user),
        )
        db.execute(
            "insert into two_factors (secret, backup_codes, user_id) values ('s', 'b', %s)",
            (user,),
        )
        db.execute(
            "insert into api_keys (user_id, name, prefix, hash, scopes)"
            " values (%s, 'k', 'etb_x', %s, '{jobs}')",
            (user, uuid.uuid4().hex),
        )
        db.execute(
            "insert into device_codes"
            " (device_hash, user_code, client_name, scopes, status, user_id, expires_at)"
            " values (%s, %s, 'Premiere panel', '{jobs:read}', 'approved', %s, now())",
            (uuid.uuid4().hex, uuid.uuid4().hex[:8], user),
        )

    account_scrub(db, ctx(outbox))

    tomb = one(db, "select * from users where id = %s", old)
    assert tomb["email"] is None
    assert tomb["display_name"] is None
    assert tomb["locale"] is None
    assert tomb["deleted_at"] is not None
    kept = one(db, "select * from users where id = %s", recent)
    assert kept["email"] is not None
    assert kept["display_name"] == "Recent"
    for table in ("sessions", "accounts", "two_factors", "device_codes", "api_keys"):
        counts = {
            user: one(db, f"select count(*)::int as n from {table} where user_id = %s", user)["n"]  # noqa: S608
            for user in (old, recent)
        }
        assert counts == {old: 0, recent: 1}, table
    check = one(db, "select ok, detail from system_checks where name = 'account_scrub'")
    assert check["ok"]
    assert check["detail"]["scrubbed"] >= 1


def test_welcome_claims_are_purged_after_12_months(db: Conn, outbox: Outbox) -> None:
    stale, fresh = uuid.uuid4().hex, uuid.uuid4().hex
    db.execute(
        "insert into welcome_grant_claims (email_hmac, claimed_at) values"
        " (%s, now() - interval '13 months'), (%s, now() - interval '11 months')",
        (stale, fresh),
    )
    retention_purge(db, ctx(outbox))
    left = db.execute(
        "select email_hmac from welcome_grant_claims where email_hmac = any(%s)", ([stale, fresh],)
    ).fetchall()
    assert [row["email_hmac"] for row in left] == [fresh]
    check = one(db, "select detail from system_checks where name = 'retention_purge'")
    assert check["detail"]["welcome_grant_claims"] >= 1


def test_connect_codes_are_purged_a_day_after_they_expire(db: Conn, outbox: Outbox) -> None:
    stale, fresh = uuid.uuid4().hex, uuid.uuid4().hex
    db.execute(
        "insert into device_codes (device_hash, user_code, client_name, scopes, expires_at) values"
        " (%s, %s, 'p', '{}', now() - interval '25 hours'),"
        " (%s, %s, 'p', '{}', now() - interval '23 hours')",
        (stale, stale[:8], fresh, fresh[:8]),
    )
    retention_purge(db, ctx(outbox))
    left = db.execute(
        "select device_hash from device_codes where device_hash = any(%s)", ([stale, fresh],)
    ).fetchall()
    assert [row["device_hash"] for row in left] == [fresh]
    check = one(db, "select detail from system_checks where name = 'retention_purge'")
    assert check["detail"]["device_codes"] >= 1


def add_jobs(db: Conn, user: str, tool: str, statuses: list[str], **times: Any) -> None:
    for status in statuses:
        db.execute(
            "insert into jobs"
            " (tool_id, user_id, source, status, queued_at, started_at, finished_at)"
            " values (%s, %s, 'web', %s, %s, %s, %s)",
            (
                tool,
                user,
                status,
                times.get("queued_at", datetime.now(UTC)),
                times.get("started_at"),
                times.get("finished_at"),
            ),
        )


def test_a_tool_failing_over_10_percent_alerts(db: Conn) -> None:
    user = new_user(db)
    bad, fine = f"test-bad-{uuid.uuid4().hex[:6]}", f"test-fine-{uuid.uuid4().hex[:6]}"
    finished = datetime.now(UTC) - timedelta(minutes=5)
    add_jobs(db, user, bad, ["failed"] * 2 + ["succeeded"] * 8, finished_at=finished)
    add_jobs(db, user, fine, ["failed"] + ["succeeded"] * 9, finished_at=finished)
    try:
        found = {a.subject: a.message for a in tool_failure_rates(db)}
        assert found[bad] == f"{bad}: 2 of 10 server jobs failed in the last 30 min (20 %)."
        assert fine not in found  # exactly 10 % is not over it
    finally:
        db.execute("delete from jobs where user_id = %s", (user,))


def test_a_slow_queue_alerts(db: Conn) -> None:
    user = new_user(db)
    add_jobs(
        db, user, "test-queue", ["queued"] * 3, queued_at=datetime.now(UTC) - timedelta(minutes=5)
    )
    try:
        [alert] = queue_wait(db)
        assert alert.rule == "queue_wait"
        assert alert.message.startswith("Queue wait p95 is 5.0 min")
    finally:
        db.execute("delete from jobs where user_id = %s", (user,))


def test_the_digest_counts_one_tashkent_day(db: Conn) -> None:
    day = date(2001, 1, 1) + timedelta(days=random.randrange(7000))  # noqa: S311
    start, end = day_bounds(day)
    user = new_user(db, created_at=start + timedelta(hours=3))
    new_user(db, created_at=end + timedelta(minutes=1))  # the next day
    add_jobs(
        db,
        user,
        "trim-video",
        ["succeeded"] * 3 + ["failed"],
        finished_at=start + timedelta(hours=1),
    )
    add_jobs(db, user, "resize-image", ["failed"], finished_at=end - timedelta(minutes=30))
    add_jobs(db, user, "trim-video", ["succeeded"], finished_at=end + timedelta(minutes=10))
    db.execute(
        "insert into purchases (user_id, provider, provider_txn_id, pack_id, credits,"
        " amount_minor, currency, status, created_at)"
        " values (%s, 'test', %s, 'starter', 100, 900, 'USD', 'completed', %s),"
        "        (%s, 'test', %s, 'starter', 100, 900, 'USD', 'pending', %s)",
        (user, uuid.uuid4().hex, start + timedelta(hours=2), user, uuid.uuid4().hex, start),
    )
    stats = digest_stats(db, day)
    assert stats["jobs"] == 5
    assert stats["failed"] == 2
    assert stats["top_tools"] == [("trim-video", 4), ("resize-image", 1)]
    assert stats["top_failing"] == [("resize-image", 1), ("trim-video", 1)]
    assert stats["revenue"] == [("USD", 900)]
    assert stats["credits_sold"] == 100
    assert stats["new_users"] == 1
    text = format_digest(stats)
    assert f"daily digest for {day.isoformat()}" in text
    assert "Server jobs: 5 (2 failed, 40 %)" in text
    assert "Revenue: 9.00 USD (100 credits sold)" in text
    assert "@" not in text  # no emails, no personal data


def test_tool_stats_sum_up_one_tashkent_day(db: Conn, outbox: Outbox) -> None:
    day = date(2001, 1, 1) + timedelta(days=random.randrange(7000))  # noqa: S311
    start, end = day_bounds(day)
    user = new_user(db)
    tool = f"test-stats-{uuid.uuid4().hex[:6]}"

    def job(status: str, run_sec: float, created: datetime, **extra: Any) -> None:
        began = created + timedelta(seconds=5)
        db.execute(
            "insert into jobs (tool_id, user_id, source, status, created_at, queued_at,"
            " started_at, finished_at, credits_charged, gpu_seconds)"
            " values (%s, %s, 'web', %s, %s, %s, %s, %s, %s, %s)",
            (
                tool,
                user,
                status,
                created,
                created,
                began,
                began + timedelta(seconds=run_sec),
                extra.get("credits", 0),
                extra.get("gpu"),
            ),
        )

    noon = start + timedelta(hours=12)
    for seconds in (10, 20, 30, 40):
        job("succeeded", seconds, noon, credits=2)
    job("failed", 100, noon)
    job("succeeded", 50, noon, gpu=12.5, credits=5)
    job("succeeded", 999, end + timedelta(minutes=1))  # the next day
    tool_stats(db, TaskContext(notifier=outbox.notifier, now=end + timedelta(hours=8)))
    rows = db.execute(
        "select runtime::text, jobs_total, jobs_failed, p50_ms, p95_ms, gpu_seconds,"
        " credits_charged from tool_stats_daily where day = %s and tool_id = %s order by 1",
        (day, tool),
    ).fetchall()
    assert [dict(row) for row in rows] == [
        {
            "runtime": "server-cpu",
            "jobs_total": 5,
            "jobs_failed": 1,
            "p50_ms": 30_000,
            "p95_ms": 88_000,
            "gpu_seconds": 0,
            "credits_charged": 8,
        },
        {
            "runtime": "server-gpu",
            "jobs_total": 1,
            "jobs_failed": 0,
            "p50_ms": 50_000,
            "p95_ms": 50_000,
            "gpu_seconds": 12.5,
            "credits_charged": 5,
        },
    ]
    # Running it again rewrites the day rather than adding to it.
    tool_stats(db, TaskContext(notifier=outbox.notifier, now=end + timedelta(hours=8)))
    again = db.execute(
        "select sum(jobs_total) as n from tool_stats_daily where day = %s and tool_id = %s",
        (day, tool),
    ).fetchone()
    assert again is not None
    assert again["n"] == 6


def test_the_scheduler_runs_each_daily_job_once(settings: Settings, db: Conn) -> None:
    outbox = Outbox(settings)
    scheduler = Scheduler(
        settings,
        outbox.notifier,
        instance=f"test-{uuid.uuid4().hex[:8]}",
        connect=lambda _: connect_url(URL),
    )
    # The lifecycle check needs storage, which this scheduler has none of (test_jobs_db covers it).
    names = [name for name in DAILY if name != "lifecycle_rules"]
    db.execute("delete from system_checks where name = any(%s)", (names,))

    # Another worker holds the lock: this one only writes its heartbeat.
    db.execute("select pg_advisory_lock(%s)", (LOCK_KEY,))
    try:
        scheduler.tick()
    finally:
        db.execute("select pg_advisory_unlock(%s)", (LOCK_KEY,))
    ran = db.execute("select name from system_checks where name = any(%s)", (names,)).fetchall()
    assert ran == []

    scheduler.tick()
    scheduler.tick()
    ran = db.execute(
        "select name from system_checks where name = any(%s) order by name", (names,)
    ).fetchall()
    assert [row["name"] for row in ran] == sorted(names)
    digests = [text for _, text in outbox.sent if "daily digest" in text]
    assert len(digests) == 1
    scheduler.leave()

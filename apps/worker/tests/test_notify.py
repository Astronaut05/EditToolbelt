from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from etb_worker.notify import DeliveryError, Notifier, build_email, send_email, send_telegram
from etb_worker.settings import Settings
from tests.conftest import VALID_ENV

TOKEN = "123456:secret-bot-token"


class FakeTelegram:
    """A local stand-in for the Bot API that records what it was sent."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.status = 200
        self.reply: dict[str, Any] = {"ok": True, "result": {}}


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[FakeTelegram, str]]:
    fake = FakeTelegram()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            fake.requests.append((self.path, json.loads(self.rfile.read(length))))
            body = json.dumps(fake.reply).encode()
            self.send_response(fake.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # Straight to the fake, never through a proxy from the environment.
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    yield fake, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def make_settings(monkeypatch: pytest.MonkeyPatch, **extra: str) -> Settings:
    for name, value in {**VALID_ENV, **extra}.items():
        monkeypatch.setenv(name, value)
    return Settings()


def test_telegram_posts_the_message_to_the_chat(
    clean_env: pytest.MonkeyPatch, telegram: tuple[FakeTelegram, str]
) -> None:
    fake, url = telegram
    settings = make_settings(
        clean_env, TELEGRAM_BOT_TOKEN=TOKEN, TELEGRAM_CHAT_ID="-1001", TELEGRAM_API_URL=url
    )
    send_telegram(settings, "Alert: something" + "x" * 5000)
    [(path, body)] = fake.requests
    assert path == f"/bot{TOKEN}/sendMessage"
    assert body["chat_id"] == "-1001"
    assert body["disable_web_page_preview"] is True
    assert len(body["text"]) == 4000


def test_telegram_errors_never_carry_the_token(
    clean_env: pytest.MonkeyPatch, telegram: tuple[FakeTelegram, str]
) -> None:
    fake, url = telegram
    settings = make_settings(
        clean_env, TELEGRAM_BOT_TOKEN=TOKEN, TELEGRAM_CHAT_ID="-1001", TELEGRAM_API_URL=url
    )
    fake.status = 401
    with pytest.raises(DeliveryError) as caught:
        send_telegram(settings, "hi")
    assert caught.value.code == "TELEGRAM_FAILED"
    assert "secret" not in str(caught.value)
    fake.status, fake.reply = 200, {"ok": False}
    with pytest.raises(DeliveryError):
        send_telegram(settings, "hi")


def test_email_is_the_backup_when_telegram_fails(clean_env: pytest.MonkeyPatch) -> None:
    settings = make_settings(
        clean_env,
        TELEGRAM_BOT_TOKEN=TOKEN,
        TELEGRAM_CHAT_ID="-1001",
        SMTP_URL="smtp://mail.test:1025",
        MAIL_FROM="alerts@example.test",
        ALERT_EMAIL="ops@example.test",
    )
    sent: list[str] = []

    def telegram_down(_: Settings, __: str) -> None:
        raise DeliveryError("TELEGRAM_FAILED", "HTTP 502")

    notifier = Notifier(
        settings, telegram=telegram_down, email=lambda _s, subject, _t: sent.append(subject)
    )
    assert notifier.send("Subject", "Text") == ["email"]
    assert sent == ["Subject"]

    ok = Notifier(settings, telegram=lambda _s, _t: None, email=lambda *_: sent.append("no"))
    assert ok.send("Subject", "Text") == ["telegram"]
    assert sent == ["Subject"]


def test_nothing_set_up_means_no_channels(settings: Settings) -> None:
    notifier = Notifier(settings)
    assert not notifier.configured
    assert notifier.send("Subject", "Text") == []


def test_email_goes_over_smtp_with_tls_when_offered(
    clean_env: pytest.MonkeyPatch, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = make_settings(
        clean_env,
        SMTP_URL="smtp://user%40x:p%40ss@mail.test:2525",
        MAIL_FROM="EditToolbelt <alerts@example.test>",
        ALERT_EMAIL="ops@example.test",
    )
    calls: list[Any] = []

    class FakeSMTP:
        def __init__(self, host: str, port: int, timeout: float) -> None:
            calls.append(("connect", host, port))

        def __enter__(self) -> FakeSMTP:
            return self

        def __exit__(self, *_: object) -> None:
            calls.append(("quit",))

        def ehlo(self) -> None:
            calls.append(("ehlo",))

        def has_extn(self, name: str) -> bool:
            return name == "starttls"

        def starttls(self, context: object) -> None:
            calls.append(("starttls",))

        def login(self, user: str, password: str) -> None:
            calls.append(("login", user, password))

        def send_message(self, message: Any) -> None:
            calls.append(("send", message["To"], message["Subject"]))

    monkeypatch.setattr("etb_worker.notify.smtplib.SMTP", FakeSMTP)
    send_email(settings, "EditToolbelt alert: disk", "Alert: Disk at 91 %")
    assert calls == [
        ("connect", "mail.test", 2525),
        ("ehlo",),
        ("starttls",),
        ("ehlo",),
        ("login", "user@x", "p@ss"),
        ("send", "ops@example.test", "EditToolbelt alert: disk"),
        ("quit",),
    ]


def test_the_email_is_plain_text(clean_env: pytest.MonkeyPatch) -> None:
    settings = make_settings(
        clean_env,
        SMTP_URL="smtp://mail.test:1025",
        MAIL_FROM="alerts@example.test",
        ALERT_EMAIL="ops@example.test",
    )
    message = build_email(settings, "Digest", "Server jobs: 0")
    assert message["From"] == "alerts@example.test"
    assert message.get_content_type() == "text/plain"
    assert message.get_content().strip() == "Server jobs: 0"

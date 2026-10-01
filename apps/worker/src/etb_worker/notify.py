"""Alert and digest delivery (docs/07 -> Alerts): a private Telegram bot, email as backup.

Outbound only: the bot sends messages and never reads any. Telegram is tried
first; email is used when Telegram isn't set up or fails. With neither set up
the message is only logged (and alerts still show in the admin's System page).
Messages carry rule names, tool ids and numbers, never personal data. The bot
token sits in the request path, so no URL or response body is ever logged.
"""

from __future__ import annotations

import json
import smtplib
import ssl
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import unquote, urlsplit

from etb_worker.logs import get_logger
from etb_worker.settings import Settings

TIMEOUT_SEC = 10
# Telegram refuses messages over 4,096 characters.
MAX_TEXT = 4000


class DeliveryError(Exception):
    """A channel couldn't deliver. ``code`` is safe to log; the message never holds a secret."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def send_telegram(settings: Settings, text: str) -> None:
    token = settings.telegram_bot_token
    if token is None or settings.telegram_chat_id is None:
        raise DeliveryError("TELEGRAM_NOT_SET_UP", "no bot token or chat id")
    base = str(settings.telegram_api_url).rstrip("/")
    if urlsplit(base).scheme not in {"https", "http"}:
        raise DeliveryError("TELEGRAM_FAILED", "API URL must be http(s)")
    body = json.dumps(
        {
            "chat_id": settings.telegram_chat_id,
            "text": text[:MAX_TEXT],
            "disable_web_page_preview": True,
        }
    ).encode()
    request = urllib.request.Request(  # noqa: S310  # scheme checked above
        f"{base}/bot{token.get_secret_value()}/sendMessage",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:  # noqa: S310
            reply = json.loads(response.read(64_000))
    except urllib.error.HTTPError as error:
        raise DeliveryError("TELEGRAM_FAILED", f"HTTP {error.code}") from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise DeliveryError("TELEGRAM_FAILED", type(error).__name__) from None
    if not isinstance(reply, dict) or reply.get("ok") is not True:
        raise DeliveryError("TELEGRAM_FAILED", "the API did not answer ok")


def build_email(settings: Settings, subject: str, text: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.mail_from or ""
    message["To"] = settings.alert_email or ""
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(domain="etb-worker.localhost")
    message.set_content(text)
    return message


def send_email(settings: Settings, subject: str, text: str) -> None:
    if settings.smtp_url is None or not settings.alert_email or not settings.mail_from:
        raise DeliveryError("EMAIL_NOT_SET_UP", "no SMTP_URL, MAIL_FROM or ALERT_EMAIL")
    url = urlsplit(settings.smtp_url.get_secret_value())
    host = url.hostname or ""
    context = ssl.create_default_context()
    try:
        client: smtplib.SMTP
        if url.scheme == "smtps":
            client = smtplib.SMTP_SSL(host, url.port or 465, timeout=TIMEOUT_SEC, context=context)
        else:
            client = smtplib.SMTP(host, url.port or 587, timeout=TIMEOUT_SEC)
        with client:
            client.ehlo()
            # Like the web's mailer: upgrade to TLS whenever the server offers it.
            if url.scheme == "smtp" and client.has_extn("starttls"):
                client.starttls(context=context)
                client.ehlo()
            if url.username:
                client.login(unquote(url.username), unquote(url.password or ""))
            client.send_message(build_email(settings, subject, text))
    except (smtplib.SMTPException, OSError) as error:
        raise DeliveryError("EMAIL_FAILED", type(error).__name__) from None


class Notifier:
    """Sends one message on the first channel that works; returns the channels used."""

    def __init__(
        self,
        settings: Settings,
        *,
        telegram: Callable[[Settings, str], None] = send_telegram,
        email: Callable[[Settings, str, str], None] = send_email,
    ) -> None:
        self._settings = settings
        self._telegram = telegram
        self._email = email

    @property
    def configured(self) -> bool:
        return self._settings.telegram_enabled or self._settings.email_enabled

    def send(self, subject: str, text: str) -> list[str]:
        log = get_logger()
        if self._settings.telegram_enabled:
            try:
                self._telegram(self._settings, text)
            except DeliveryError as error:
                log.warning("notify.failed", channel="telegram", error_code=error.code)
            else:
                return ["telegram"]
        if self._settings.email_enabled:
            try:
                self._email(self._settings, subject, text)
            except DeliveryError as error:
                log.warning("notify.failed", channel="email", error_code=error.code)
            else:
                return ["email"]
        return []

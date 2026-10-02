"""Environment validation for the worker.

Mirrors the names in packages/core/src/env.ts (serverEnvSchema). Invalid or
missing values stop the process with a readable list; values are never echoed.
"""

from __future__ import annotations

import sys
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, HttpUrl, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "test", "staging", "production"]
LogLevel = Literal["debug", "info", "warn", "error"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_ignore_empty=True,  # `FOO=` falls back to the default, like the TS side
        extra="ignore",
        frozen=True,
    )

    app_env: AppEnv = "local"
    app_version: str = Field(default="dev", min_length=1)
    log_level: LogLevel = "info"

    # SecretStr: the URL carries the password, keep it out of reprs and errors.
    database_url: SecretStr
    s3_endpoint: HttpUrl
    s3_region: str = Field(default="auto", min_length=1)
    s3_bucket: str = Field(pattern=r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
    s3_access_key_id: SecretStr
    s3_secret_access_key: SecretStr

    # Jobs this worker runs at once, one tool process each (docs/01 -> Workers).
    worker_slots: int = Field(default=1, ge=1, le=32)

    # The GPU tools' backend (docs/01 -> GPU backend): `modal` runs them on
    # Modal (ServerlessGpu) with MODAL_TOKEN_ID and MODAL_TOKEN_SECRET, which the
    # Modal client reads from the environment itself; `local` is the dev-only
    # LocalGpu; unset, the GPU tools are off on this worker.
    gpu_backend: Literal["modal", "local"] | None = None
    modal_token_id: SecretStr | None = None
    modal_token_secret: SecretStr | None = None

    # Alerts and the daily digest (docs/07 -> Alerts): Telegram first, email as
    # backup. Both optional; with neither, alerts are only logged and listed in
    # the admin's System page.
    telegram_bot_token: SecretStr | None = None
    telegram_chat_id: str | None = Field(default=None, pattern=r"^(-?\d{1,20}|@\w{5,32})$")
    # Telegram's Bot API; tests point it at a local fake.
    telegram_api_url: HttpUrl = HttpUrl("https://api.telegram.org")
    smtp_url: SecretStr | None = None
    mail_from: str | None = Field(default=None, min_length=3, max_length=200)
    alert_email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    @field_validator("database_url")
    @classmethod
    def _postgres_url(cls, value: SecretStr) -> SecretStr:
        parts = urlsplit(value.get_secret_value())
        if parts.scheme not in {"postgres", "postgresql"} or not parts.hostname:
            msg = "must be a postgres:// or postgresql:// URL"
            raise ValueError(msg)
        return value

    @field_validator("smtp_url")
    @classmethod
    def _smtp_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            parts = urlsplit(value.get_secret_value())
            if parts.scheme not in {"smtp", "smtps"} or not parts.hostname:
                msg = "must be an smtp:// or smtps:// URL"
                raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _no_debug_in_production(self) -> Settings:
        if self.app_env == "production" and self.log_level == "debug":
            msg = "LOG_LEVEL: debug logging is not allowed in production"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _alert_channels_complete(self) -> Settings:
        if (self.telegram_bot_token is None) != (self.telegram_chat_id is None):
            msg = "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID: set both, or neither"
            raise ValueError(msg)
        if self.alert_email and not (self.smtp_url and self.mail_from):
            msg = "ALERT_EMAIL: needs SMTP_URL and MAIL_FROM to send"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _gpu_backend_complete(self) -> Settings:
        if (self.modal_token_id is None) != (self.modal_token_secret is None):
            msg = "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET: set both, or neither"
            raise ValueError(msg)
        if self.gpu_backend == "modal" and self.modal_token_id is None:
            msg = "GPU_BACKEND=modal: needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
            raise ValueError(msg)
        if self.gpu_backend == "local" and self.app_env == "production":
            msg = "GPU_BACKEND=local: LocalGpu is for development only"
            raise ValueError(msg)
        return self

    @property
    def telegram_enabled(self) -> bool:
        return self.telegram_bot_token is not None and self.telegram_chat_id is not None

    @property
    def email_enabled(self) -> bool:
        return bool(self.alert_email and self.smtp_url and self.mail_from)


def format_errors(error: ValidationError) -> list[str]:
    lines = []
    for issue in error.errors(include_input=False, include_url=False):
        key = ".".join(str(part) for part in issue["loc"]).upper() or "(env)"
        if issue["type"] == "missing":
            lines.append(f"{key}: required but not set")
        elif key == "(env)":
            lines.append(str(issue["msg"]).removeprefix("Value error, "))
        else:
            lines.append(f"{key}: {str(issue['msg']).removeprefix('Value error, ')}")
    return lines


def load_settings() -> Settings:
    """Validate the environment or exit the process with a readable list of problems."""
    try:
        return Settings()  # values come from the environment
    except ValidationError as error:
        lines = ["Invalid environment for worker:"]
        lines += [f"  - {line}" for line in format_errors(error)]
        lines.append("See .env.example for every variable and what it is for.")
        print("\n".join(lines), file=sys.stderr)  # logging isn't configured yet
        raise SystemExit(1) from None

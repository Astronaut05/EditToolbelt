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

    @field_validator("database_url")
    @classmethod
    def _postgres_url(cls, value: SecretStr) -> SecretStr:
        parts = urlsplit(value.get_secret_value())
        if parts.scheme not in {"postgres", "postgresql"} or not parts.hostname:
            msg = "must be a postgres:// or postgresql:// URL"
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def _no_debug_in_production(self) -> Settings:
        if self.app_env == "production" and self.log_level == "debug":
            msg = "LOG_LEVEL: debug logging is not allowed in production"
            raise ValueError(msg)
        return self


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

from __future__ import annotations

import pytest
from pydantic import ValidationError

from etb_worker.settings import Settings, format_errors, load_settings
from tests.conftest import VALID_ENV


def test_valid_env_with_defaults(settings: Settings) -> None:
    assert settings.app_env == "local"
    assert settings.app_version == "dev"
    assert settings.log_level == "info"
    assert settings.s3_bucket == "etb-local"


def test_secrets_stay_out_of_repr(settings: Settings) -> None:
    text = repr(settings)
    assert "secret-pass" not in text
    assert "super-secret" not in text


def test_missing_variables_are_named(clean_env: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError) as caught:
        Settings()
    assert format_errors(caught.value) == [
        "DATABASE_URL: required but not set",
        "S3_ENDPOINT: required but not set",
        "S3_BUCKET: required but not set",
        "S3_ACCESS_KEY_ID: required but not set",
        "S3_SECRET_ACCESS_KEY: required but not set",
    ]


def test_empty_values_count_as_unset(clean_env: pytest.MonkeyPatch) -> None:
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    clean_env.setenv("LOG_LEVEL", "")
    assert Settings().log_level == "info"


def test_rejects_non_postgres_url(clean_env: pytest.MonkeyPatch) -> None:
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    clean_env.setenv("DATABASE_URL", "mysql://user:secret-pass@db/etb")
    with pytest.raises(ValidationError) as caught:
        Settings()
    assert format_errors(caught.value) == [
        "DATABASE_URL: must be a postgres:// or postgresql:// URL"
    ]


def test_refuses_debug_in_production(clean_env: pytest.MonkeyPatch) -> None:
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    clean_env.setenv("APP_ENV", "production")
    clean_env.setenv("LOG_LEVEL", "debug")
    with pytest.raises(ValidationError) as caught:
        Settings()
    assert format_errors(caught.value) == ["LOG_LEVEL: debug logging is not allowed in production"]


def test_load_settings_exits_without_echoing_values(
    clean_env: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    clean_env.setenv("DATABASE_URL", "not-a-url-secret-pass")
    clean_env.setenv("S3_BUCKET", "Bad_Bucket_super-secret")
    with pytest.raises(SystemExit) as caught:
        load_settings()
    assert caught.value.code == 1
    err = capsys.readouterr().err
    assert "Invalid environment for worker:" in err
    assert "DATABASE_URL" in err
    assert "S3_BUCKET" in err
    assert "secret" not in err

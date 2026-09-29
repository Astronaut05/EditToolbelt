"""Structured JSON logging (docs/07-admin-and-logging.md -> Operational logs).

Same shape as the web's pino logger (packages/core/src/logger.ts): one JSON
object per line with ts, level, service, env, version, event, plus request_id,
job_id, tool_id, user_ref, duration_ms, error_code where they apply.

Usage: ``log.info("job.succeeded", tool_id=..., duration_ms=...)``.
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime
from typing import Any, Literal, TextIO

import structlog
from structlog.typing import EventDict, WrappedLogger

from etb_worker.redact import redact, redact_string

Service = Literal["worker", "sweeper"]

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}
# structlog names levels after the method called; pino's names are the shared ones.
_LEVEL_NAMES = {"warning": "warn", "critical": "fatal", "exception": "error"}
_FIRST_KEYS = ("level", "ts", "service", "env", "version")


def _timestamp(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    # Millisecond ISO-8601 with Z, identical to JavaScript's Date.toISOString().
    event_dict["ts"] = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return event_dict


def _normalise_level(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    level = str(event_dict.get("level", "info"))
    event_dict["level"] = _LEVEL_NAMES.get(level, level)
    return event_dict


def _error_from_exc_info(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    """Turn ``exc_info=True`` / ``log.exception()`` into pino's ``err: {type, message, stack}``."""
    exc_info = event_dict.pop("exc_info", None)
    if exc_info:
        error = exc_info if isinstance(exc_info, BaseException) else sys.exc_info()[1]
        if error is not None:
            event_dict["err"] = error  # redact() converts and scrubs it
    return event_dict


def _redact(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
    redacted: EventDict = redact(event_dict)
    # Shared fields first so lines read the same as the web's.
    ordered = {key: redacted.pop(key) for key in _FIRST_KEYS if key in redacted}
    ordered.update(redacted)
    return ordered


_render_json = structlog.processors.JSONRenderer(separators=(",", ":"))  # compact, like pino


def _json_line(logger: WrappedLogger, name: str, event_dict: EventDict) -> str:
    # Last line of defence: pattern-scrub the finished line, as the web does.
    rendered = _render_json(logger, name, event_dict)
    text = rendered.decode() if isinstance(rendered, bytes) else rendered
    return redact_string(text)


class _StdlibToStructlog(logging.Handler):
    """Route library logs (boto3, psycopg, ...) into the same JSON stream."""

    def emit(self, record: logging.LogRecord) -> None:
        level = record.levelname.lower()
        structlog.get_logger().log(
            _LEVELS.get(_LEVEL_NAMES.get(level, level), logging.INFO),
            "lib.log",
            logger=record.name,
            detail=record.getMessage(),
        )


def configure_logging(
    *,
    service: Service,
    env: str,
    version: str,
    level: str,
    stream: TextIO | None = None,
) -> None:
    def add_base(_: WrappedLogger, __: str, event_dict: EventDict) -> EventDict:
        event_dict.setdefault("service", service)
        event_dict.setdefault("env", env)
        event_dict.setdefault("version", version)
        return event_dict

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            _normalise_level,
            _timestamp,
            add_base,
            _error_from_exc_info,
            _redact,
            _json_line,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(_LEVELS[level]),
        logger_factory=structlog.WriteLoggerFactory(file=stream or sys.stdout),
        cache_logger_on_first_use=False,
    )

    root = logging.getLogger()
    root.handlers = [_StdlibToStructlog()]
    root.setLevel(logging.WARNING)


def get_logger(**bindings: Any) -> structlog.typing.FilteringBoundLogger:
    logger: structlog.typing.FilteringBoundLogger = structlog.get_logger(**bindings)
    return logger

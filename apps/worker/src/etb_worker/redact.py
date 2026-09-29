"""Log redaction backstop (docs/07-admin-and-logging.md -> Operational logs).

Python twin of packages/core/src/redact.ts. Both are tested against the same
cases in fixtures/logging/redaction-cases.json, so change the two together.
"""

from __future__ import annotations

import re
from typing import Any

REDACTED = "[redacted]"
MAX_DEPTH = 10

# Keys (lowercased, non-alphanumerics removed) redacted when they contain one of these.
SENSITIVE_KEY_PARTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "accesskey",
    "privatekey",
    "authorization",
    "cookie",
    "email",
    "filename",
    "presigned",
    "signedurl",
)

# Keys (normalised the same way) redacted only on an exact match.
SENSITIVE_KEYS = frozenset(
    {
        "ip",
        "ipaddress",
        "clientip",
        "remoteaddr",
        "remoteaddress",
        "xforwardedfor",
        "cfconnectingip",
        "originalname",
        "filepath",
        "body",
        "requestbody",
        "payload",
        "content",
        "contents",
        "filecontent",
        "filecontents",
        "session",
        "uploadurl",
        "downloadurl",
    }
)

_NON_ALNUM = re.compile(r"[^a-z0-9]")
_URL_WITH_QUERY = re.compile(r"(https?://[^\s\"'<>?#]+)\?[^\s\"'<>#]*")
_BEARER = re.compile(r"\bbearer\s+[A-Za-z0-9_.~+/=-]+", re.IGNORECASE)
_API_KEY = re.compile(r"\betb_(?:live|test)_[A-Za-z0-9]+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def is_sensitive_key(key: str) -> bool:
    normalised = _NON_ALNUM.sub("", key.lower())
    return normalised in SENSITIVE_KEYS or any(part in normalised for part in SENSITIVE_KEY_PARTS)


def redact_string(value: str) -> str:
    """Scrub signed URL queries, bearer tokens, API keys and email addresses from free text."""
    value = _URL_WITH_QUERY.sub(r"\1?[redacted]", value)
    value = _BEARER.sub("Bearer [redacted]", value)
    value = _API_KEY.sub("[redacted-key]", value)
    return _EMAIL.sub("[redacted-email]", value)


def _error_to_dict(error: BaseException) -> dict[str, str]:
    import traceback  # noqa: PLC0415  (only needed when an error is logged)

    stack = "".join(traceback.format_exception(error))
    return {
        "type": type(error).__name__,
        "message": redact_string(str(error)),
        "stack": redact_string(stack),
    }


def _walk(value: Any, depth: int, ancestors: set[int]) -> Any:  # noqa: PLR0911  (type dispatch)
    if isinstance(value, str):
        return redact_string(value)
    if value is None or isinstance(value, bool | int | float):
        return value
    if depth >= MAX_DEPTH:
        return "[truncated]"
    if id(value) in ancestors:
        return "[circular]"
    # File bytes must never reach a log line, whatever key they hide under.
    if isinstance(value, bytes | bytearray | memoryview):
        return "[binary]"
    if isinstance(value, BaseException):
        return _error_to_dict(value)

    ancestors.add(id(value))
    try:
        if isinstance(value, dict):
            return {
                str(key): REDACTED
                if is_sensitive_key(str(key))
                else _walk(item, depth + 1, ancestors)
                for key, item in value.items()
            }
        if isinstance(value, list | tuple | set | frozenset):
            return [_walk(item, depth + 1, ancestors) for item in value]
        return redact_string(str(value))
    finally:
        ancestors.discard(id(value))


def redact(value: Any) -> Any:
    """Return a redacted deep copy of a log payload. Never mutates the input."""
    return _walk(value, 0, set())

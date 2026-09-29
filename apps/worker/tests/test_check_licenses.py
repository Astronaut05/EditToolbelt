from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "check_licenses.py"
_SPEC = importlib.util.spec_from_file_location("check_licenses", _PATH)
assert _SPEC is not None
assert _SPEC.loader is not None
check_licenses = importlib.util.module_from_spec(_SPEC)
sys.modules["check_licenses"] = check_licenses
_SPEC.loader.exec_module(check_licenses)

ALLOWED = {"mit", "apache-2.0", "bsd-3-clause"}


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("MIT", True),
        ("MIT OR Apache-2.0", True),
        ("(MIT OR GPL-3.0)", True),
        ("MIT AND GPL-3.0", False),
        ("GPL-3.0 OR (MIT AND Apache-2.0)", True),
        ("LGPL-3.0-only", False),
        ("Apache-2.0 WITH LLVM-exception", True),
        ("AGPL-3.0-or-later", False),
    ],
)
def test_is_satisfiable(expression: str, expected: bool) -> None:
    assert check_licenses.is_satisfiable(expression, ALLOWED) is expected


def test_family_ignores_only_and_or_later() -> None:
    assert check_licenses.family("LGPL-3.0-only") == "lgpl-3.0"
    assert check_licenses.family("GPL-2.0-or-later") == "gpl-2.0"
    assert check_licenses.family("GPL-2.0+") == "gpl-2.0"


def test_requirement_names_are_normalised() -> None:
    assert check_licenses.requirement_name("psycopg[binary]>=3.3") == "psycopg"
    assert check_licenses.requirement_name("Pydantic_Settings >= 2") == "pydantic-settings"
    assert check_licenses.requirement_name("uv_build>=0.12.20,<0.13") == "uv-build"

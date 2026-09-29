"""License register check for the worker's Python dependencies.

Run from apps/worker: ``uv run python scripts/check_licenses.py``.

The npm side, GitHub Actions and Docker images are checked by
scripts/check-licenses.ts at the repo root. Both read licenses.json, the
machine-readable copy of docs/13-licenses.md. This script fails when:

- a dependency declared in pyproject.toml (runtime, dev group or build backend)
  is not registered, is still marked "verify", or is banned;
- an installed package's license doesn't match the register;
- any installed distribution (including transitive ones) has a license that is
  banned, unknown, or copyleft without a register entry.
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from importlib import metadata
from pathlib import Path
from typing import Any

WORKER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKER_DIR.parents[1]
PROJECT_NAME = "etb-worker"

# Trove classifiers -> SPDX ids, for packages without License-Expression metadata.
CLASSIFIERS = {
    "MIT License": "MIT",
    "Apache Software License": "Apache-2.0",
    "BSD License": "BSD-3-Clause",
    "ISC License (ISCL)": "ISC",
    "Python Software Foundation License": "PSF-2.0",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0",
    "GNU Lesser General Public License v2 (LGPLv2)": "LGPL-2.1",
    "GNU General Public License v3 (GPLv3)": "GPL-3.0",
    "GNU General Public License v2 (GPLv2)": "GPL-2.0",
    "GNU Affero General Public License v3": "AGPL-3.0",
    "The Unlicense (Unlicense)": "Unlicense",
    "Zope Public License": "ZPL-2.1",
}


SPDX_LIKE = re.compile(r"[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*")


def normalise_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_name(requirement: str) -> str:
    match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", requirement)
    if not match:
        msg = f"can't parse requirement {requirement!r}"
        raise ValueError(msg)
    return normalise_name(match.group(1))


def family(license_id: str) -> str:
    """LGPL-3.0-only / LGPL-3.0-or-later / LGPL-3.0+ -> LGPL-3.0 (case-insensitive)."""
    return re.sub(r"(-only|-or-later|\+)$", "", license_id.strip()).lower()


def license_ids(expression: str) -> list[str]:
    """Split an SPDX expression into its license ids (operators and parentheses dropped)."""
    tokens = re.split(r"[\s()]+", expression)
    return [t for t in tokens if t and t.upper() not in {"AND", "OR", "WITH"}]


def is_satisfiable(expression: str, allowed: set[str]) -> bool:
    """True if the expression can be met using only allowed licenses (OR = pick one, AND = all)."""
    expression = expression.strip()
    # Strip one pair of wrapping parentheses.
    if expression.startswith("(") and expression.endswith(")") and _balanced(expression[1:-1]):
        return is_satisfiable(expression[1:-1], allowed)
    for operator, combine in ((" OR ", any), (" AND ", all)):
        parts = _split_top_level(expression, operator)
        if len(parts) > 1:
            return combine(is_satisfiable(part, allowed) for part in parts)
    base = expression.split(" WITH ")[0]
    return family(base) in allowed


def _balanced(text: str) -> bool:
    depth = 0
    for char in text:
        depth += {"(": 1, ")": -1}.get(char, 0)
        if depth < 0:
            return False
    return depth == 0


def _split_top_level(expression: str, operator: str) -> list[str]:
    parts, depth, current, i = [], 0, "", 0
    upper = expression.upper()
    while i < len(expression):
        char = expression[i]
        depth += {"(": 1, ")": -1}.get(char, 0)
        if depth == 0 and upper.startswith(operator, i):
            parts.append(current)
            current, i = "", i + len(operator)
            continue
        current += char
        i += 1
    parts.append(current)
    return parts


def detect_license(dist: metadata.Distribution) -> str | None:
    meta = dist.metadata
    expression = meta.get("License-Expression")
    if expression:
        return str(expression)
    ids = [
        CLASSIFIERS[c.rsplit(" :: ", 1)[-1]]
        for c in meta.get_all("Classifier") or []
        if c.startswith("License :: ") and c.rsplit(" :: ", 1)[-1] in CLASSIFIERS
    ]
    if ids:
        # Several license classifiers on one package mean it is dual-licensed.
        return " OR ".join(dict.fromkeys(ids))
    # Older metadata: a bare SPDX id in the free-text License field (e.g. boto3's "Apache-2.0").
    text = str(meta.get("License") or "").strip()
    if SPDX_LIKE.fullmatch(text):
        return text
    return None


def load_register() -> dict[str, Any]:
    register: dict[str, Any] = json.loads((REPO_ROOT / "licenses.json").read_text("utf-8"))
    return register


def declared_dependencies() -> dict[str, str]:
    """Direct dependencies from pyproject.toml -> where they are declared."""
    project = tomllib.loads((WORKER_DIR / "pyproject.toml").read_text("utf-8"))
    found: dict[str, str] = {}
    for requirement in project["project"].get("dependencies", []):
        found[requirement_name(requirement)] = "dependencies"
    for group, requirements in project.get("dependency-groups", {}).items():
        for requirement in requirements:
            if isinstance(requirement, str):
                found.setdefault(requirement_name(requirement), f"dependency-groups.{group}")
    for requirement in project.get("build-system", {}).get("requires", []):
        found.setdefault(requirement_name(requirement), "build-system")
    return found


def main() -> int:
    register = load_register()
    policy = register["policy"]
    allowed = {family(x) for x in policy["allowed"]}
    server_ok = allowed | {family(x) for x in policy["copyleftServerOnly"]}
    banned = {family(x) for x in policy["banned"]}

    entries: dict[str, dict[str, Any]] = {}
    for entry in register["entries"]:
        if entry["ecosystem"] == "pypi":
            for name in entry["packages"]:
                entries[normalise_name(name)] = entry
    banned_packages = {
        normalise_name(name): item["reason"]
        for item in register.get("banned", [])
        if item["ecosystem"] == "pypi"
        for name in item["packages"]
    }
    reviewed = {
        normalise_name(item["package"]): item
        for item in register.get("reviewedTransitive", [])
        if item["ecosystem"] == "pypi"
    }

    errors: list[str] = []

    for name, where in sorted(declared_dependencies().items()):
        entry = entries.get(name)
        if name in banned_packages:
            errors.append(f"{name} ({where}) is banned: {banned_packages[name]}")
        elif entry is None:
            errors.append(
                f"{name} ({where}) is not in licenses.json. Check its license, add it to "
                "docs/13-licenses.md and licenses.json, then install."
            )
        elif entry["status"] == "verify":
            errors.append(f"{name} is marked 'verify': confirm its license, then set a status.")

    for dist in metadata.distributions():
        name = normalise_name(dist.metadata["Name"])
        if name == PROJECT_NAME:
            continue
        detected = detect_license(dist)
        if name in banned_packages:
            errors.append(f"{name} {dist.version} is installed but banned: {banned_packages[name]}")
            continue
        entry = entries.get(name)
        if entry is not None:
            registered = {family(x) for x in license_ids(entry["license"])}
            if detected and {family(x) for x in license_ids(detected)} != registered:
                errors.append(
                    f"{name} {dist.version}: installed license {detected!r} doesn't match "
                    f"the register ({entry['license']!r}). Review it and update the register."
                )
            continue
        if name in reviewed:
            continue
        if detected is None:
            errors.append(f"{name} {dist.version}: no license metadata. Review it and register it.")
        elif any(family(x) in banned for x in license_ids(detected)) and not is_satisfiable(
            detected, allowed
        ):
            errors.append(f"{name} {dist.version}: banned license {detected!r}.")
        elif not is_satisfiable(detected, allowed):
            kind = "copyleft" if is_satisfiable(detected, server_ok) else "unrecognised"
            errors.append(
                f"{name} {dist.version}: {kind} license {detected!r} needs a register entry "
                "or a reviewedTransitive note in licenses.json."
            )

    if errors:
        print("License check failed (Python):", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("License check passed (Python).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

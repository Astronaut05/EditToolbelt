"""Model weights for the GPU images, pinned by SHA-256 (docs/13-licenses.md -> Models).

``pins.json`` beside this file lists every weights file a GPU function needs:
where it comes from, its SHA-256 and the licence it was approved under.
While Modal builds a function's image it runs this file as a script,
``python weights.py <pins.json> <group> <dest>``: the group's files are
downloaded and each one's SHA-256 checked, and any mismatch exits non-zero,
which fails the image build. So a changed or swapped file never reaches a
GPU, and a function never downloads anything when it runs.

Standard library only: it runs in the images before anything else is there.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any

PINS_PATH = Path(__file__).with_name("pins.json")
#: Licences a pinned file may carry (docs/13 -> Rules: explicitly commercial-use weights).
LICENSES = frozenset({"MIT", "BSD-3-Clause", "BSD-2-Clause", "Apache-2.0"})
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_CHUNK = 1024 * 1024
_TIMEOUT_SEC = 120


class PinError(Exception):
    """pins.json is malformed, or a file isn't what it was pinned as."""


@dataclass(frozen=True)
class Pin:
    name: str
    group: str
    url: str
    sha256: str
    bytes: int | None
    license: str


def _pin(name: str, raw: Any) -> Pin:
    if not isinstance(raw, dict):
        raise PinError(f"{name}: not an object")
    if not _NAME.match(name):
        raise PinError(f"{name}: a file name, without folders")
    sha = str(raw.get("sha256") or "")
    if not _SHA256.match(sha):
        raise PinError(f"{name}: sha256 must be 64 lowercase hex characters")
    url = str(raw.get("url") or "")
    if not url.startswith("https://"):
        raise PinError(f"{name}: url must be https")
    if str(raw.get("license")) not in LICENSES:
        raise PinError(f"{name}: licence {raw.get('license')!r} is not one docs/13 allows")
    size = raw.get("bytes")
    if size is not None and (not isinstance(size, int) or size <= 0):
        raise PinError(f"{name}: bytes must be a positive integer or null")
    group = str(raw.get("group") or "")
    if not _NAME.match(group):
        raise PinError(f"{name}: needs a group")
    return Pin(name=name, group=group, url=url, sha256=sha, bytes=size, license=raw["license"])


def load_pins(path: Path = PINS_PATH) -> dict[str, Pin]:
    """Every pinned file by name, checked."""
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PinError(f"{path.name}: {error}") from None
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, dict) or not files:
        raise PinError(f"{path.name}: needs a non-empty `files` object")
    return {name: _pin(name, raw) for name, raw in files.items()}


def group_pins(pins: dict[str, Pin], group: str) -> list[Pin]:
    found = [pin for pin in pins.values() if pin.group == group]
    if not found:
        raise PinError(f"no pinned files in group {group!r}")
    return found


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path: Path, pin: Pin) -> None:
    """Raises PinError unless ``path`` is exactly the pinned file."""
    size = path.stat().st_size
    if pin.bytes is not None and size != pin.bytes:
        raise PinError(f"{pin.name}: {size} bytes, pinned as {pin.bytes}")
    actual = sha256_of(path)
    if actual != pin.sha256:
        raise PinError(f"{pin.name}: SHA-256 is {actual}, pinned as {pin.sha256}")


Opener = Callable[[str], IO[bytes]]


def _open(url: str) -> IO[bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "edittoolbelt-gpu-build"})  # noqa: S310
    response: IO[bytes] = urllib.request.urlopen(request, timeout=_TIMEOUT_SEC)  # noqa: S310
    return response


def fetch(pin: Pin, dest: Path, opener: Opener | None = None) -> Path:
    """Downloads ``pin`` into ``dest`` and checks it; a mismatch leaves nothing behind."""
    opener = opener or _open
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / pin.name
    partial = dest / f".{pin.name}.part"
    try:
        with opener(pin.url) as source, partial.open("wb") as out:
            shutil.copyfileobj(source, out, _CHUNK)
        verify(partial, pin)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)
    return target


def fetch_group(
    group: str, dest: Path, pins_path: Path = PINS_PATH, opener: Opener | None = None
) -> list[Path]:
    return [fetch(pin, dest, opener) for pin in group_pins(load_pins(pins_path), group)]


def main(argv: list[str]) -> int:
    """``weights.py <pins.json> <group> <dest>``; exit 1 (failing the image build) on a problem."""
    if len(argv) != 3:
        print("usage: weights.py <pins.json> <group> <dest>", file=sys.stderr)
        return 2
    pins_path, group, dest = Path(argv[0]), argv[1], Path(argv[2])
    try:
        for path in fetch_group(group, dest, pins_path):
            print(f"pinned weights ok: {path.name}")
    except (PinError, OSError) as error:
        print(f"weights check failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

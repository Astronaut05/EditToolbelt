"""The worker's scratch folders: one per job or probe, all under one root.

The root is ``etb-work`` in the system temp folder. Each folder is deleted
when its job or probe ends, but a worker that is killed leaves its folders
behind, each holding a user's input and maybe an output. So a worker clears
the root when it starts. While it runs it holds a lock on the root: a second
worker on the same host (local development) sees the lock and leaves the
folders alone, since they're in use.
"""

from __future__ import annotations

import fcntl
import shutil
import tempfile
from pathlib import Path
from typing import IO

ROOT_NAME = "etb-work"
LOCK_NAME = ".lock"

# The lock is held for as long as the process runs; the system drops it when it exits.
_held: list[IO[bytes]] = []


def root(base: Path | None = None) -> Path:
    """The root, made if missing (only this user may enter it)."""
    path = (base or Path(tempfile.gettempdir())) / ROOT_NAME
    path.mkdir(mode=0o700, exist_ok=True)
    return path


def new_dir(prefix: str) -> Path:
    """A fresh folder for one job or probe."""
    return Path(tempfile.mkdtemp(prefix=prefix, dir=root()))


def clear_leftovers(base: Path | None = None) -> int | None:
    """At start: locks the root for this process and removes everything left in it.

    Returns how many entries it removed, or None when another worker on this
    host holds the root (then nothing is removed).
    """
    folder = root(base)
    lock = (folder / LOCK_NAME).open("ab")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return None
    _held.append(lock)
    removed = 0
    for entry in folder.iterdir():
        if entry.name == LOCK_NAME:
            continue
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)
        removed += 1
    return removed

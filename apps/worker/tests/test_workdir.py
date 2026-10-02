"""Job folders a killed worker left behind go when the next worker starts."""

from __future__ import annotations

import fcntl
from collections.abc import Iterator
from pathlib import Path
from typing import IO

import pytest

from etb_worker import workdir


@pytest.fixture
def held(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[IO[bytes]]]:
    """This test's locks, released at the end (a real worker holds its lock until it exits)."""
    locks: list[IO[bytes]] = []
    monkeypatch.setattr(workdir, "_held", locks)
    yield locks
    for lock in locks:
        lock.close()


def leave_behind(root: Path) -> None:
    job = root / "etb-job-abc123"
    job.mkdir()
    (job / "input").write_bytes(b"a user's file")
    (root / "etb-probe-def456").mkdir()
    (root / "stray").write_bytes(b"x")


def test_a_starting_worker_removes_what_a_killed_one_left(
    tmp_path: Path, held: list[IO[bytes]]
) -> None:
    root = workdir.root(tmp_path)
    leave_behind(root)
    assert workdir.clear_leftovers(tmp_path) == 3
    assert [entry.name for entry in root.iterdir()] == [workdir.LOCK_NAME]
    assert len(held) == 1  # held while the worker runs


def test_folders_another_running_worker_holds_are_left_alone(
    tmp_path: Path, held: list[IO[bytes]]
) -> None:
    root = workdir.root(tmp_path)
    leave_behind(root)
    with (root / workdir.LOCK_NAME).open("ab") as other:
        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert workdir.clear_leftovers(tmp_path) is None
    assert len(list(root.iterdir())) == 4
    assert held == []


def test_job_folders_live_under_the_root() -> None:
    folder = workdir.new_dir("etb-job-")
    try:
        assert folder.parent == workdir.root()
        assert folder.name.startswith("etb-job-")
        assert oct(folder.parent.stat().st_mode & 0o777) == oct(0o700)
    finally:
        folder.rmdir()

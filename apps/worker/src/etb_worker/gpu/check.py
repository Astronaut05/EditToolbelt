"""Calls the deployed GPU app: ``python -m etb_worker.gpu.check [--gpu]``.

CI runs it after each deploy (.github/workflows/modal.yml). ``--gpu`` also
runs ``gpu_check`` on a T4, which costs a few GPU-seconds. Prints outcomes
only; the token comes from MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.
"""

from __future__ import annotations

import sys
import time

import modal

from etb_worker.gpu.modal_app import APP_NAME


def main(argv: list[str]) -> int:
    started = time.monotonic()
    answer = modal.Function.from_name(APP_NAME, "ping").remote()
    print(f"ping: {answer} ({time.monotonic() - started:.1f} s)")
    if "--gpu" in argv:
        started = time.monotonic()
        answer = modal.Function.from_name(APP_NAME, "gpu_check").remote()
        print(f"gpu_check: {answer} ({time.monotonic() - started:.1f} s, cold start included)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

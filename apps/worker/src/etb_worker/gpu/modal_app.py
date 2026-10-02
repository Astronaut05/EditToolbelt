"""The GPU functions on Modal (docs/01-architecture.md -> GPU backend: ServerlessGpu).

CI deploys this as the app `edittoolbelt-gpu` on every merge to main
(.github/workflows/modal.yml). The worker calls its functions and polls them;
Modal never calls us. Inputs and outputs move through R2 presigned URLs and
nothing is kept on Modal: a call works in its container's temporary directory,
which goes with the container. Containers scale to zero when idle.

So far: `ping` (no GPU) proves the deploy and the token, and `gpu_check` asks
a T4 its name for a few seconds. The tools' functions come with M5's GPU tools.
"""

from __future__ import annotations

import subprocess

import modal

APP_NAME = "edittoolbelt-gpu"

app = modal.App(APP_NAME)

image = modal.Image.debian_slim(python_version="3.12")


@app.function(image=image, timeout=60)
def ping() -> dict[str, str]:
    """Answers without a GPU: the app is deployed and the caller's token works."""
    return {"status": "ok", "app": APP_NAME}


@app.function(image=image, gpu="T4", timeout=120, max_containers=1)
def gpu_check() -> dict[str, str]:
    """The GPU the function got, as nvidia-smi names it (a few GPU-seconds)."""
    out = subprocess.run(
        ["/usr/bin/nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    return {"gpu": out.stdout.strip()}

"""Asks the worker image's own ffmpeg and ffprobe what the worker asks them (CI's stack job).

The tests run on the runner's ffmpeg (Ubuntu's 6.x); the image carries
Debian's (7.x). The probe names the sections and fields it wants
(``-show_entries``) and counts packets (``-count_packets``). A name the
image's ffprobe didn't know would make it exit non-zero, and every upload
would be refused. So the same calls are made here, inside the image, on files
its own ffmpeg has just written:

    docker compose run --rm -T -v "$PWD/apps/worker/scripts:/scripts:ro" worker \
        python /scripts/check_image_probe.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from etb_worker.probe import probe_json, summarize
from etb_worker.processors.merge_videos import ENTRIES


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", *args], check=True)  # noqa: S603, S607


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        mkv, mp4 = Path(folder) / "clip.mkv", Path(folder) / "clip.mp4"
        ffmpeg(
            *("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2"),
            *("-f", "lavfi", "-i", "sine=frequency=440:duration=2"),
            *("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(mkv)),
        )
        ffmpeg("-i", str(mkv), "-c", "copy", str(mp4))
        for path, mime in ((mkv, "video/x-matroska"), (mp4, "video/mp4")):
            # The upload probe: its sections, its packet count, its length.
            record = summarize(probe_json(path), mime)
            print(path.name, json.dumps(record))
            video = record["video"] or {}
            if (
                video.get("fps") != 30
                or (video.get("width"), video.get("height")) != (320, 240)
                or record["audio"] is None
                or not 1900 <= record["duration_ms"] <= 2200
            ):
                print("the probe misread a 2 s, 30 fps, 320x240 clip with sound")
                return 1
            # Merge Videos' own read of a clip: its sections, and a hash of each codec's parameters.
            asked = subprocess.run(  # noqa: S603
                [  # noqa: S607
                    "ffprobe",
                    *("-v", "error", "-print_format", "json", "-show_entries", ENTRIES),
                    *("-show_data_hash", "sha256", "-i", str(path)),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            streams = json.loads(asked.stdout)["streams"]
            if not all(s.get("extradata_hash") for s in streams if s["codec_type"] == "video"):
                print("Merge Videos' read gave no hash of the picture's parameters")
                return 1
    print("the image's ffmpeg answers the worker's probes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

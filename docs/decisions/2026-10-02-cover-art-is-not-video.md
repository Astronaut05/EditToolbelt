# 2026-10-02 · A file's cover art is not its video

**Decision:**
- **The probe takes the first video stream that isn't an attached picture** (`disposition.attached_pic`) as the file's picture. Its frame times come from ffprobe's `V:0`, which picks the same stream. A song with artwork (MP3, M4A, FLAC) probes as sound only.
- **The CPU processors map `0:V:0`**, ffmpeg's video streams without attached pictures (Compress Video, VFR to CFR, Burn Subtitles), so a video whose artwork comes before its picture is encoded from the picture. The GPU code already skipped attached pictures (`gpu/video.py`).

**Why:** ffprobe gives cover art a frame rate of 90,000 fps. Since [2026-10-02-server-tools-take-up-to-240-fps.md](2026-10-02-server-tools-take-up-to-240-fps.md), the jobs API refused such a song for Noise Reduction or Transcribe Audio: "This video runs at 90000 fps". Music bought or ripped with a player's tools usually carries artwork.

**Reverse:** `_picture` in `apps/worker/src/etb_worker/probe.py` and the `0:V:0` maps; `tests/test_probe.py` (`test_a_songs_cover_art_is_not_a_picture`) shows what comes back.

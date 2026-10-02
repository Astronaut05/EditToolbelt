"""A12 Transcribe Audio and V17 Auto Subtitles (tools/audio.md -> A12, tools/video.md -> V17).

One GPU function, Whisper large-v3 (modal_app.transcribe), for both tools.
It writes Whisper's transcript as JSON to storage; this processor reads it
back, deletes it at once, and writes the format the person asked for
(captions.py): TXT, SRT, VTT or JSON for A12; SRT, VTT, ASS or TXT with
line limits, optional word timing and optional translation to English for
V17. V17's page extracts the sound in the browser first, so only the audio
is uploaded. The function hears no more of the file than the job was
priced for (``max_seconds``), whatever the file's header says.
"""

from __future__ import annotations

import contextlib
from typing import Any

from etb_worker import captions
from etb_worker.processors import Estimate, JobContext, JobFailed, Output
from etb_worker.processors.remote import length_cap, run_on_gpu
from etb_worker.storage import StorageError

#: Whisper large-v3 on an L4: GPU seconds per second of audio (a guess, for progress), plus loading.
REAL_TIME_FACTOR = 0.1
OVERHEAD_SEC = 25.0
LANGUAGE_NAMES = {"uz": "Uzbek", "ru": "Russian", "en": "English"}


class Transcribe:
    tool_id: str
    remote = True

    def __init__(self, tool_id: str, default_format: str, *, subtitles: bool) -> None:
        self.tool_id = tool_id
        self.default_format = default_format
        self.subtitles = subtitles

    def estimate(self, meta: dict[str, Any], options: dict[str, Any]) -> Estimate:
        seconds = float(meta.get("duration_ms") or 0) / 1000
        return Estimate(seconds=OVERHEAD_SEC + REAL_TIME_FACTOR * seconds)

    def run(self, ctx: JobContext) -> Output:
        if not ctx.meta.get("audio"):
            raise JobFailed("NO_AUDIO", "This file has no sound to transcribe.")
        # Whisper hears no more than was priced per minute, whatever the header said.
        max_seconds = length_cap(ctx.meta)
        fmt = str(ctx.options.get("format") or self.default_format)
        if fmt not in captions.FORMATS:
            fmt = self.default_format
        language = str(ctx.options.get("language") or "auto")
        translate = bool(self.subtitles and ctx.options.get("translate"))
        outcome = run_on_gpu(
            ctx,
            function="transcribe",
            options={
                "language": language,
                "task": "translate" if translate else "transcribe",
                "max_seconds": max_seconds,
            },
            content_type="application/json",
            estimate_sec=self.estimate(ctx.meta, ctx.options).seconds,
            stage="transcribing",
        )
        assert ctx.storage is not None  # run_on_gpu checked it  # noqa: S101
        raw = ctx.workdir / "transcript.json"
        try:
            ctx.storage.download(outcome.key, raw)
        finally:
            # The transcript is the person's words: it goes as soon as it's read.
            with contextlib.suppress(StorageError):
                ctx.storage.delete(outcome.key)
        try:
            transcript = captions.parse(raw.read_text("utf-8"))
        except ValueError:
            raise JobFailed("GPU_FAILED", "Our GPU server couldn't finish this one.") from None
        finally:
            raw.unlink(missing_ok=True)
        if not transcript.segments:
            raise JobFailed("NO_SPEECH", "We heard no speech in this file, so nothing was charged.")
        max_chars = int(ctx.options.get("maxChars") or 42)
        max_lines = int(ctx.options.get("maxLines") or 2)
        words = bool(ctx.options.get("words"))
        text = captions.render(
            transcript, fmt, max_chars=max_chars, max_lines=max_lines, words=words
        )
        ext, content_type = captions.FORMATS[fmt]
        out = ctx.workdir / f"out.{ext}"
        out.write_text(text, "utf-8")
        cues = len(captions.build_cues(transcript, max_chars, max_lines)) if self.subtitles else 0
        return Output(
            path=out,
            content_type=f"{content_type}; charset=utf-8",
            ext=ext,
            meta={
                "language": transcript.language,
                "cues": cues,
                "notes": [
                    *self._notes(transcript, fmt, language, translate, words, cues),
                    *outcome.result.notes,
                ],
            },
        )

    def _notes(  # noqa: PLR0913, PLR0917 - one line per fact it reports
        self,
        transcript: captions.Transcript,
        fmt: str,
        language: str,
        translate: bool,
        words: bool,
        cues: int,
    ) -> list[str]:
        heard = LANGUAGE_NAMES.get(transcript.language, transcript.language.upper())
        notes = [
            f"Translated to English from {heard}"
            if translate
            else f"Language: {heard}" + (" (detected)" if language == "auto" else "")
        ]
        if self.subtitles and cues:
            notes.append(f"{cues} subtitles")
        if words and fmt in {"srt", "txt"}:
            notes.append(f"{fmt.upper()} has no word timing; pick VTT or ASS for it")
        return notes


TRANSCRIBE_AUDIO: Transcribe = Transcribe("transcribe-audio", "txt", subtitles=False)
AUTO_SUBTITLES: Transcribe = Transcribe("auto-subtitles", "srt", subtitles=True)

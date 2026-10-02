"""Timed text from a transcript: SRT, VTT, ASS, TXT and JSON.

tools/video.md -> V17 Auto Subtitles, tools/audio.md -> A12 Transcribe Audio.

The GPU function returns Whisper's transcript as JSON: segments with their
words and each word's time. Everything about how it reads happens here, on
the worker's CPU, where it's cheap and testable:

- Cues are built word by word. A cue ends before it would need more than
  ``max_lines`` lines of ``max_chars``, run past 7 s, or jump a pause of
  0.8 s, and preferably at the end of a sentence once it holds half a line.
- Lines are balanced: the fewest lines that fit, then the narrowest width
  that still fits in them, so two lines come out about equal.
- Cues never overlap and last at least 0.5 s where the next one allows.

Whisper's words keep their leading space ("" in languages written without
spaces), so text is joined as it came and only trimmed at the edges.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import dataclass

MAX_CUE_SEC = 7.0
PAUSE_SEC = 0.8
MIN_CUE_SEC = 0.5
PARAGRAPH_PAUSE_SEC = 1.5
SENTENCE_END = (".", "?", "!", "…", "。", "？", "！")  # noqa: RUF001


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    #: As Whisper wrote it, with its leading space.
    text: str


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str
    words: tuple[Word, ...]


@dataclass(frozen=True)
class Transcript:
    language: str
    segments: tuple[Segment, ...]


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: tuple[str, ...]
    words: tuple[Word, ...]


def _float(value: object) -> float:
    return float(value) if isinstance(value, int | float) and math.isfinite(value) else 0.0


def parse(text: str) -> Transcript:
    """The GPU function's JSON. Anything malformed is dropped rather than trusted."""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("not a transcript")  # noqa: TRY004 - callers catch ValueError
    segments: list[Segment] = []
    for raw in data.get("segments") or []:
        if not isinstance(raw, dict):
            continue
        words = tuple(
            Word(_float(w.get("start")), _float(w.get("end")), str(w.get("word") or ""))
            for w in raw.get("words") or []
            if isinstance(w, dict) and str(w.get("word") or "").strip()
        )
        body = str(raw.get("text") or "")
        if not body.strip() and not words:
            continue
        segments.append(Segment(_float(raw.get("start")), _float(raw.get("end")), body, words))
    return Transcript(language=str(data.get("language") or ""), segments=tuple(segments))


def _segment_words(segment: Segment) -> list[Word]:
    """A segment's words; without word times, its words spread evenly over it."""
    if segment.words:
        return list(segment.words)
    pieces = segment.text.split()
    if not pieces:
        return []
    step = max(segment.end - segment.start, 0.0) / len(pieces)
    return [
        Word(segment.start + i * step, segment.start + (i + 1) * step, f" {piece}")
        for i, piece in enumerate(pieces)
    ]


def _join(tokens: list[str]) -> str:
    return "".join(tokens).strip()


def _greedy(tokens: list[str], width: int) -> list[list[int]]:
    """Token indices per line, filling each line up to ``width`` characters."""
    lines: list[list[int]] = []
    current: list[int] = []
    for index, token in enumerate(tokens):
        if current and len(_join([tokens[i] for i in current] + [token])) > width:
            lines.append(current)
            current = []
        current.append(index)
    if current:
        lines.append(current)
    return lines


def wrap_groups(tokens: list[str], max_chars: int) -> list[list[int]]:
    """The fewest lines of at most ``max_chars``, as even as they can be (token indices)."""
    if not tokens:
        return []
    count = len(_greedy(tokens, max_chars))
    low = max(1, math.ceil(len(_join(tokens)) / count))
    for width in range(low, max_chars + 1):
        lines = _greedy(tokens, width)
        if len(lines) <= count:
            return lines
    return _greedy(tokens, max_chars)


def wrap(tokens: list[str], max_chars: int) -> list[str]:
    return [_join([tokens[i] for i in line]) for line in wrap_groups(tokens, max_chars)]


def build_cues(transcript: Transcript, max_chars: int = 42, max_lines: int = 2) -> list[Cue]:
    """Subtitle cues from the transcript's words (see the module's docstring)."""
    cues: list[list[Word]] = []
    current: list[Word] = []
    for segment in transcript.segments:
        words = _segment_words(segment)
        for index, word in enumerate(words):
            if current:
                tokens = [w.text for w in (*current, word)]
                too_long = len(wrap(tokens, max_chars)) > max_lines
                too_slow = word.end - current[0].start > MAX_CUE_SEC
                paused = word.start - current[-1].end >= PAUSE_SEC
                sentence = current[-1].text.rstrip().endswith(SENTENCE_END)
                half_full = len(_join([w.text for w in current])) >= max_chars / 2
                new_segment = index == 0
                if too_long or too_slow or paused or ((sentence or new_segment) and half_full):
                    cues.append(current)
                    current = []
            current.append(word)
    if current:
        cues.append(current)
    built: list[Cue] = []
    for words in cues:
        built.append(
            Cue(
                start=words[0].start,
                end=max(words[-1].end, words[0].start),
                lines=tuple(wrap([w.text for w in words], max_chars)),
                words=tuple(words),
            )
        )
    return _settle(built)


def _settle(cues: list[Cue]) -> list[Cue]:
    """No overlaps; at least MIN_CUE_SEC where the next cue leaves room."""
    settled: list[Cue] = []
    for index, cue in enumerate(cues):
        following = cues[index + 1].start if index + 1 < len(cues) else math.inf
        end = max(cue.end, cue.start + MIN_CUE_SEC)
        end = min(end, following) if following > cue.start else end
        settled.append(Cue(cue.start, max(end, cue.start), cue.lines, cue.words))
    return settled


def _clock(seconds: float, separator: str) -> str:
    total = max(0, round(seconds * 1000))
    hours, rest = divmod(total, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _ass_clock(seconds: float) -> str:
    total = max(0, round(seconds * 100))
    hours, rest = divmod(total, 360_000)
    minutes, rest = divmod(rest, 6000)
    secs, centis = divmod(rest, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centis:02d}"


def srt(cues: list[Cue]) -> str:
    blocks = [
        f"{n}\n{_clock(cue.start, ',')} --> {_clock(cue.end, ',')}\n" + "\n".join(cue.lines)
        for n, cue in enumerate(cues, start=1)
    ]
    return "\n\n".join(blocks) + "\n" if blocks else ""


def _timed_lines(cue: Cue, max_chars: int, tag: Callable[[int, Word], str]) -> list[str]:
    """The cue's lines, wrapped as the plain ones are, with ``tag(i, word)`` before each word."""
    words = list(cue.words)
    lines: list[str] = []
    for group in wrap_groups([w.text for w in words], max_chars):
        parts = []
        for position, index in enumerate(group):
            text = words[index].text
            space = "" if position == 0 else text[: len(text) - len(text.lstrip())]
            parts.append(space + tag(index, words[index]) + text.lstrip())
        lines.append("".join(parts))
    return lines


def _vtt_text(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def vtt(cues: list[Cue], *, words: bool = False, max_chars: int = 42) -> str:
    """WebVTT; with ``words``, a timestamp tag before each word after the first."""
    out = ["WEBVTT", ""]
    for cue in cues:
        out.append(f"{_clock(cue.start, '.')} --> {_clock(cue.end, '.')}")
        if words and cue.words:
            escaped = Cue(
                cue.start,
                cue.end,
                cue.lines,
                tuple(Word(w.start, w.end, _vtt_text(w.text)) for w in cue.words),
            )
            out.extend(
                _timed_lines(
                    escaped, max_chars, lambda i, w: f"<{_clock(w.start, '.')}>" if i else ""
                )
            )
        else:
            out.extend(_vtt_text(line) for line in cue.lines)
        out.append("")
    return "\n".join(out)


ASS_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
    "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
    "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
)
#: White Noto Sans with a black outline, bottom centre: what Burn Subtitles draws ASS with.
ASS_STYLE = (
    "Style: Default,Noto Sans,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,"
    "0,0,0,0,100,100,0,0,1,3,0,2,80,80,60,1"
)
ASS_HEADER = (
    "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n"
    "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\n"
    f"{ASS_FORMAT}\n{ASS_STYLE}\n\n[Events]\n"
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
)


def _ass_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def _karaoke(cue: Cue) -> Callable[[int, Word], str]:
    """``{\\k}`` tags: each word lasts until the next one starts, so the cue keeps its time."""
    starts = [w.start for w in cue.words[1:]] + [cue.end]

    def tag(index: int, word: Word) -> str:
        return "{\\k" + str(max(1, round((starts[index] - word.start) * 100))) + "}"

    return tag


def ass(cues: list[Cue], *, words: bool = False, max_chars: int = 42) -> str:
    """ASS with a plain style Burn Subtitles draws in Noto Sans; karaoke timing with ``words``."""
    events: list[str] = []
    for cue in cues:
        if words and cue.words:
            escaped = Cue(
                cue.start,
                cue.end,
                cue.lines,
                tuple(Word(w.start, w.end, _ass_text(w.text)) for w in cue.words),
            )
            body = "\\N".join(_timed_lines(escaped, max_chars, _karaoke(cue)))
        else:
            body = "\\N".join(_ass_text(line) for line in cue.lines)
        events.append(
            f"Dialogue: 0,{_ass_clock(cue.start)},{_ass_clock(cue.end)},Default,,0,0,0,,{body}"
        )
    return ASS_HEADER + "\n".join(events) + ("\n" if events else "")


def txt(transcript: Transcript) -> str:
    """Plain text: the segments as sentences, a new paragraph after a pause."""
    paragraphs: list[list[str]] = []
    last_end: float | None = None
    for segment in transcript.segments:
        text = segment.text.strip() or _join([w.text for w in segment.words])
        if not text:
            continue
        if last_end is None or segment.start - last_end >= PARAGRAPH_PAUSE_SEC:
            paragraphs.append([])
        paragraphs[-1].append(text)
        last_end = segment.end
    return "\n\n".join(" ".join(p) for p in paragraphs) + ("\n" if paragraphs else "")


def as_json(transcript: Transcript) -> str:
    """Our JSON: segments with their text and every word's time, in seconds to the ms."""

    def ms(value: float) -> float:
        return round(value, 3)

    data = {
        "language": transcript.language,
        "segments": [
            {
                "start": ms(segment.start),
                "end": ms(segment.end),
                "text": segment.text.strip(),
                "words": [
                    {"start": ms(w.start), "end": ms(w.end), "text": w.text.strip()}
                    for w in segment.words
                ],
            }
            for segment in transcript.segments
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


#: Format -> (extension, content type).
FORMATS: dict[str, tuple[str, str]] = {
    "srt": ("srt", "application/x-subrip"),
    "vtt": ("vtt", "text/vtt"),
    "ass": ("ass", "text/x-ssa"),
    "txt": ("txt", "text/plain"),
    "json": ("json", "application/json"),
}


def render(
    transcript: Transcript,
    fmt: str,
    *,
    max_chars: int = 42,
    max_lines: int = 2,
    words: bool = False,
) -> str:
    if fmt == "txt":
        return txt(transcript)
    if fmt == "json":
        return as_json(transcript)
    cues = build_cues(transcript, max_chars, max_lines)
    if fmt == "srt":
        return srt(cues)
    if fmt == "vtt":
        return vtt(cues, words=words, max_chars=max_chars)
    if fmt == "ass":
        return ass(cues, words=words, max_chars=max_chars)
    raise ValueError(f"unknown format {fmt!r}")

"""Subtitles and text from Whisper's transcript (V17 Auto Subtitles, A12 Transcribe Audio)."""

from __future__ import annotations

import itertools
import json
from typing import Any

import pytest

from etb_worker import captions
from etb_worker.captions import Transcript, build_cues, parse, render, wrap


def timed(text: str, start: float, step: float = 0.4) -> list[dict[str, Any]]:
    return [
        {
            "start": round(start + i * step, 3),
            "end": round(start + i * step + step - 0.05, 3),
            "word": f" {word}",
        }
        for i, word in enumerate(text.split())
    ]


def transcript(*segments: tuple[str, float], step: float = 0.4) -> Transcript:
    raw = {
        "language": "en",
        "segments": [
            {
                "start": start,
                "end": start + step * len(text.split()),
                "text": f" {text}",
                "words": timed(text, start, step),
            }
            for text, start in segments
        ],
    }
    return parse(json.dumps(raw))


def test_lines_are_balanced_within_the_limit() -> None:
    tokens = [" one", " two", " three", " four", " five", " six"]
    assert wrap(tokens, 20) == ["one two three", "four five six"]
    assert wrap(tokens, 42) == ["one two three four five six"]
    # A word longer than the line still gets a line of its own.
    assert wrap([" a", " supercalifragilistic", " b"], 10) == ["a", "supercalifragilistic", "b"]
    # Languages without spaces join as they came.
    assert wrap(["你好", "世界"], 42) == ["你好世界"]


def test_cues_respect_lines_characters_length_and_pauses() -> None:
    long = " ".join(f"word{i}" for i in range(40))
    cues = build_cues(transcript((long, 0.0), ("After a pause.", 30.0)), max_chars=20, max_lines=2)
    for cue in cues:
        assert len(cue.lines) <= 2
        assert all(len(line) <= 20 for line in cue.lines)
        assert cue.end - cue.start <= captions.MAX_CUE_SEC + 0.5
    assert cues[-1].lines == ("After a pause.",)
    # In order, never overlapping, every word kept once.
    assert all(a.end <= b.start for a, b in itertools.pairwise(cues))
    assert [w.text.strip() for cue in cues for w in cue.words] == [
        *long.split(),
        "After",
        "a",
        "pause.",
    ]


def test_a_cue_ends_at_a_sentence_once_it_holds_half_a_line() -> None:
    cues = build_cues(
        transcript(("This is the first sentence here. And then a second one follows.", 0.0)),
        max_chars=42,
        max_lines=2,
    )
    assert [" ".join(cue.lines) for cue in cues] == [
        "This is the first sentence here.",
        "And then a second one follows.",
    ]


def test_short_cues_last_half_a_second_unless_the_next_one_starts() -> None:
    raw = {
        "language": "en",
        "segments": [
            {
                "start": 0,
                "end": 0.1,
                "text": " Hi.",
                "words": [{"start": 0, "end": 0.1, "word": " Hi."}],
            },
            {
                "start": 5,
                "end": 5.1,
                "text": " Yo.",
                "words": [{"start": 5, "end": 5.1, "word": " Yo."}],
            },
        ],
    }
    cues = build_cues(parse(json.dumps(raw)))
    assert [(c.start, c.end) for c in cues] == [(0, 0.5), (5, 5.5)]


def test_srt_and_vtt() -> None:
    t = transcript(("Hello there, this is a short test of the subtitle maker.", 0.0), step=0.36)
    assert render(t, "srt") == (
        "1\n00:00:00,000 --> 00:00:03,910\n"
        "Hello there, this is a short\ntest of the subtitle maker.\n"
    )
    assert render(t, "vtt") == (
        "WEBVTT\n\n00:00:00.000 --> 00:00:03.910\n"
        "Hello there, this is a short\ntest of the subtitle maker.\n"
    )
    timed_vtt = render(t, "vtt", words=True)
    assert "Hello <00:00:00.360>there, <00:00:00.720>this" in timed_vtt
    assert "\n<00:00:02.160>test <00:00:02.520>of" in timed_vtt


def test_text_that_looks_like_markup_is_escaped() -> None:
    t = transcript(("Use <b> & {curly} braces", 0.0))
    assert "Use &lt;b&gt; &amp; {curly} braces" in render(t, "vtt")
    assert "Use <b> & (curly) braces" in render(t, "ass")


def test_ass_has_a_style_and_karaoke_that_keeps_time() -> None:
    raw = {
        "language": "en",
        "segments": [
            {
                "start": 0,
                "end": 2,
                "text": " Hi you.",
                "words": [
                    {"start": 0, "end": 0.3, "word": " Hi"},
                    {"start": 0.5, "end": 0.9, "word": " you."},
                ],
            }
        ],
    }
    text = render(parse(json.dumps(raw)), "ass", words=True)
    assert "Style: Default,Noto Sans,64" in text
    assert text.splitlines()[-1] == (
        "Dialogue: 0,0:00:00.00,0:00:00.90,Default,,0,0,0,,{\\k50}Hi {\\k40}you."
    )


def test_text_breaks_into_paragraphs_at_pauses_and_json_keeps_every_word() -> None:
    t = transcript(("First part.", 0.0), ("Still first.", 1.0), ("Second part.", 10.0))
    assert render(t, "txt") == "First part. Still first.\n\nSecond part.\n"
    data = json.loads(render(t, "json"))
    assert data["language"] == "en"
    assert [w["text"] for w in data["segments"][0]["words"]] == ["First", "part."]
    assert data["segments"][2]["start"] == 10.0


def test_segments_without_word_times_spread_their_words() -> None:
    raw = {"language": "ru", "segments": [{"start": 0, "end": 4, "text": " Привет мир как дела"}]}
    cues = build_cues(parse(json.dumps(raw)))
    assert cues[0].lines == ("Привет мир как дела",)
    assert [w.start for w in cues[0].words] == [0, 1, 2, 3]


def test_malformed_parts_are_dropped_and_unknown_formats_refused() -> None:
    raw = {
        "language": "en",
        "segments": [
            "x",
            {"start": "a", "text": " ", "words": []},
            {"start": 1, "end": 2, "text": " ok"},
        ],
    }
    t = parse(json.dumps(raw))
    assert len(t.segments) == 1
    assert t.segments[0].start == 1
    with pytest.raises(ValueError, match="not a transcript"):
        parse("[]")
    with pytest.raises(ValueError, match="unknown format"):
        render(t, "docx")
    assert render(parse('{"segments": []}'), "srt") == ""

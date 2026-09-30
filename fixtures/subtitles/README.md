# Subtitle fixtures

Written for EditToolbelt's tests; public domain. `messy.srt` is UTF-8 with a BOM and CRLF line endings on purpose (a missing blank line, dot and comma milliseconds, a cue without an index, an end before its start, a blank cue). Encoded variants (UTF-16, Windows-1251, Windows-1252) are made from these in the tests.

`drifted.srt` is `roundtrip.srt` made 2.5 s late and 0.1 % slow (every time × 1.001 + 2500 ms), for Subtitle Sync's two-point test.

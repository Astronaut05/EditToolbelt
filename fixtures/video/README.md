# Video fixtures

Generated for EditToolbelt's tests from FFmpeg's built-in test pattern and tone; public domain. Both are 30 s at 256 × 144 px and 30 fps. Every 2 s is a keyframe (GOP 60), and a 440 Hz tone beeps once a second, so trims and cuts can be checked by time.

- `clip-h264-aac.mp4`: H.264 Main + AAC-LC, stereo, 48 kHz. What phones and cameras make.
- `clip-vp9-opus.webm`: VP9 + Opus, stereo, 48 kHz. Plays in the test browsers, which lack H.264 and AAC.

Made with FFmpeg 7.0:

```sh
ffmpeg -f lavfi -i "testsrc2=size=256x144:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:beep_factor=4:sample_rate=48000:duration=30" -ac 2 \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 44 -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 48k -movflags +faststart -map_metadata -1 -fflags +bitexact clip-h264-aac.mp4

ffmpeg -f lavfi -i "testsrc2=size=256x144:rate=30:duration=30" \
  -f lavfi -i "sine=frequency=440:beep_factor=4:sample_rate=48000:duration=30" -ac 2 \
  -c:v libvpx-vp9 -crf 60 -b:v 0 -g 60 -row-mt 1 -deadline good -cpu-used 4 \
  -c:a libopus -b:a 32k -map_metadata -1 -fflags +bitexact clip-vp9-opus.webm
```

For Video Info, two 4 s clips remuxed from `clip-h264-aac.mp4` (video only, no re-encode) by `node packages/engines/scripts/video-fixtures.ts`:

- `clip-vfr.mp4`: the frames on an irregular clock (each gap 70 % to 130 % of a frame), like a phone recording: variable frame rate.
- `clip-hlg.mp4`: the same frames tagged BT.2020 with the HLG transfer, like an HDR phone video.

For GIF to MP4, `anim-delays.gif` (64 × 48 px, six frames with delays of 30, 70, 0, 250, 40 and 110 ms, the first frame's blue transparent), written byte by byte by `node packages/engines/scripts/gif-fixtures.ts`.

For Merge Videos, `clip-vp9-25fps.webm`: 4 s of the same test pattern at 320 × 240 px and 25 fps (a keyframe every 2 s), with a 660 Hz tone, VP9 + Opus. A clip of another size and rate to join with the 30 fps ones. Made with FFmpeg 6.1:

```sh
ffmpeg -f lavfi -i "testsrc2=size=320x240:rate=25:duration=4" \
  -f lavfi -i "sine=frequency=660:beep_factor=4:sample_rate=48000:duration=4" -ac 2 \
  -c:v libvpx-vp9 -crf 60 -b:v 0 -g 50 -row-mt 1 -deadline good -cpu-used 4 \
  -c:a libopus -b:a 32k -map_metadata -1 -fflags +bitexact clip-vp9-25fps.webm
```

For Video Converter, `clip-h264-aac.mov` (H.264 + AAC in QuickTime) and `clip-vp9-opus.mkv` (VP9 + Opus in Matroska): the first 4 s of the clips above, remuxed without re-encoding by `node packages/engines/scripts/converter-fixtures.ts`.

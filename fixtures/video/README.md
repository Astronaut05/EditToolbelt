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

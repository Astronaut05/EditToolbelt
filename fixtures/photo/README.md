# Photo fixtures

- `face.jpg`: a 256 × 256 px copy of NASA's portrait of astronaut Eileen Collins, public domain ("No known copyright restrictions", NASA Great Images; the same picture as scikit-image's `astronaut.png`, SHA-256 `88431cd9…cb5`). Blur & Pixelate's test puts four copies of it, at four sizes, into one image to check that Find faces finds four faces. Made with FFmpeg 6.1:

```sh
ffmpeg -i astronaut.png -vf scale=256:256:flags=lanczos -q:v 4 face.jpg
```

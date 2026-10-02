# Tool registry — master list

Every tool the site will have. The code registry (`packages/registry`) must contain exactly these codes; CI enforces it. Detailed specs are in the category files.

**Legend**
- **Wave:** 1 = launch (M2 launch set + M2b, all in-browser) · 2 = with server/credits (M4–M8) · 3 = later.
- **Runtime:** `client` browser only · `hybrid` browser first, server fallback · `cpu` server CPU · `gpu` server GPU. See `docs/01-architecture.md`.
- **Cost:** credits for **server** runs only. Browser runs are always free. Numbers are placeholders (`docs/05-credits-and-payments.md`).
- **Surfaces:** W = web (every tool is on web) · M = featured on mobile home · P = in the Premiere panel · A = available through the public API (server tools only; calculators ship in `packages/core`).

Totals: 75 tools · Wave 1: 26 · Wave 2: 32 · Wave 3: 17.

## Launch set (M2)

15 Wave 1 tools ship at first launch; the other 11 Wave 1 tools follow in M2b (`docs/12-milestones.md`). Chosen for search demand and to need only 6 engines.

| Area | Launch set | M2b |
|---|---|---|
| Photo | P02 Crop, P03 Resize, P05 Compress, P06 Converter (HEIC), P07 Remove Background | P04 Rotate & Flip |
| Video | V01 Trim (fast + full re-encode), V02 Compress, V04 Video to GIF, V06 Extract Audio | V03 Converter, V05 GIF to MP4, V07 Mute, V08 Video Info |
| Audio | — | A01 Converter, A02 Trim, A03 BPM & Key |
| Color | C03 Color Converter | C01 Palette, C02 Picker |
| Subtitles & Time | T01 Subtitle Converter, T04 Timecode, T05 Aspect Ratio, T06 Bitrate | T02 Subtitle Shift |
| Utility | U01 QR Code | — |

## Photo — `tools/photo.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| P01 | Photo Editor | `photo-editor` | 2 | client | image-geometry + image-paint | — | W |
| P02 | Crop Image | `crop-image` | 1 | client | image-geometry | — | W M |
| P03 | Resize Image | `resize-image` | 1 | client | image-geometry | — | W M |
| P04 | Rotate & Flip Image | `rotate-image` | 1 | client | image-geometry | — | W M |
| P05 | Compress Image | `compress-image` | 1 | client | image-codec | — | W M |
| P06 | Image Converter (incl. HEIC) | `image-converter` | 1 | client | image-codec | — | W M |
| P07 | Remove Background | `remove-background` | 1 | hybrid | image-ml / image-ml-server | 2 flat (hi-res server) | W M P A |
| P08 | Upscale Image | `upscale-image` | 2 | gpu | image-ml-server | 1 per 4 output MP, min 2 | W M P A |
| P09 | Draw on Image | `draw-on-image` | 2 | client | image-paint | — | W |
| P10 | Add Text to Image | `add-text-to-image` | 2 | client | image-paint | — | W M |
| P11 | Watermark Images | `watermark-image` | 2 | client | image-paint | — | W |
| P12 | Blur & Pixelate (incl. auto face blur) | `blur-image` | 2 | client | image-paint + image-ml | — | W M |
| P13 | Social Media Image Resizer | `social-media-image-resizer` | 2 | client | image-geometry | — | W M |
| P14 | Split Image into Grid | `split-image` | 2 | client | image-geometry | — | W M |
| P15 | Photo Metadata Viewer & Remover | `exif-remover` | 2 | client | media-probe + image-codec | — | W M |
| P16 | Collage Maker | `collage-maker` | 3 | client | image-geometry | — | W M |
| P17 | Object Eraser | `object-eraser` | 3 | gpu | image-ml-server | 3 flat | W M A |
| P18 | Images to PDF | `images-to-pdf` | 3 | client | image-geometry | — | W M |
| P19 | Image to SVG | `image-to-svg` | 3 | client | image-vector | — | W |

## Video — `tools/video.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| V01 | Trim Video | `trim-video` | 1 | client | video-webcodecs | — | W M |
| V02 | Compress Video | `compress-video` | 1 | hybrid | video-webcodecs / video-ffmpeg-server | 1/min, min 2 | W M A |
| V03 | Video Converter | `video-converter` | 1 | hybrid | video-webcodecs / server | 1/min, min 1 | W M A |
| V04 | Video to GIF | `video-to-gif` | 1 | client | video-webcodecs | — | W M |
| V05 | GIF to MP4 | `gif-to-mp4` | 1 | client | video-webcodecs | — | W M |
| V06 | Extract Audio from Video | `extract-audio` | 1 | client | video-webcodecs + audio-dsp | — | W M |
| V07 | Mute Video | `mute-video` | 1 | client | video-webcodecs | — | W M |
| V08 | Video Info & VFR Check | `video-info` | 1 | client | media-probe | — | W P |
| V09 | Resize & Crop Video for Social | `resize-video` | 2 | client | video-webcodecs | — | W M |
| V10 | Extract Frames / Thumbnail | `extract-frames` | 2 | client | video-webcodecs | — | W M |
| V11 | Rotate & Flip Video | `rotate-video` | 2 | client | video-webcodecs | — | W M |
| V12 | Merge Videos | `merge-videos` | 2 | hybrid | video-webcodecs / video-ffmpeg-server | 1/min, min 1 | W A |
| V13 | Change Video Speed | `video-speed` | 2 | client | video-webcodecs | — | W M |
| V14 | Add or Replace Audio in Video | `replace-audio` | 2 | client | video-webcodecs | — | W |
| V15 | VFR to CFR (fix phone footage) | `vfr-to-cfr` | 2 | cpu | video-ffmpeg-server | 1/min, min 1 | W P A |
| V16 | Burn Subtitles into Video | `burn-subtitles` | 2 | cpu | video-ffmpeg-server | 1/min, min 2 | W A |
| V17 | Auto Subtitles | `auto-subtitles` | 2 | gpu | video-ml-server | 2/min, min 2 | W M P A |
| V18 | Reverse Video | `reverse-video` | 3 | client | video-webcodecs | — | W M |
| V19 | Loop Video | `loop-video` | 3 | client | video-webcodecs | — | W M |
| V20 | Upscale Video | `upscale-video` | 3 | gpu | video-ml-server | 10/min, min 10 | W P A |
| V21 | Video Background Remover | `video-background-remover` | 3 | gpu | video-ml-server | 8/min, min 8 | W A |

## Audio — `tools/audio.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| A01 | Audio Converter (incl. sample rate) | `audio-converter` | 1 | client | video-webcodecs | — | W M |
| A02 | Trim Audio | `trim-audio` | 1 | client | video-webcodecs | — | W M |
| A03 | BPM & Key Finder (+ tap tempo, metronome) | `bpm-key-finder` | 1 | client | audio-dsp | — | W M |
| A04 | Merge Audio | `merge-audio` | 2 | client | audio-dsp | — | W |
| A05 | Normalize Loudness (LUFS) | `normalize-audio` | 2 | client | audio-dsp | — | W P |
| A06 | Loudness Meter | `loudness-meter` | 2 | client | audio-dsp | — | W P |
| A07 | Fade In / Fade Out | `fade-audio` | 2 | client | audio-dsp | — | W M |
| A08 | Change Speed & Pitch | `change-pitch` | 2 | client | audio-dsp | — | W M |
| A09 | Stem Splitter | `stem-splitter` | 2 | gpu | audio-ml-server | 3/min, min 3 | W M P A |
| A10 | Noise Reduction | `remove-noise` | 2 | cpu | video-ffmpeg-server (afftdn; audio-ml-server once a model is licensed) | 1/min, min 1 | W M P A |
| A11 | Remove Silence | `remove-silence` | 2 | client | audio-dsp | — | W P |
| A12 | Transcribe Audio | `transcribe-audio` | 2 | gpu | audio-ml-server | 2/min, min 2 | W M P A |
| A13 | Audio Channel Tools | `audio-channels` | 2 | client | audio-dsp | — | W P |
| A14 | Split Audio | `split-audio` | 3 | client | audio-dsp | — | W |
| A15 | Reverse Audio | `reverse-audio` | 3 | client | audio-dsp | — | W M |
| A16 | Audio to Video (waveform / audiogram) | `audio-to-video` | 3 | client | audio-dsp + video-webcodecs | — | W M |

## Color — `tools/color.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| C01 | Color Palette from Image | `color-palette-from-image` | 1 | client | image-color | — | W M |
| C02 | Color Picker from Image | `color-picker-from-image` | 1 | client | image-color | — | W M |
| C03 | Color Converter | `color-converter` | 1 | client | text | — | W M P |
| C04 | Contrast Checker | `contrast-checker` | 2 | client | text | — | W M |
| C05 | LUT Preview on Image | `lut-preview` | 2 | client | image-color | — | W |
| C06 | LUT Converter | `lut-converter` | 3 | client | text | — | W P |
| C07 | Gradient Generator | `gradient-generator` | 3 | client | image-color | — | W |

## Subtitles & Time — `tools/subtitles-and-time.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| T01 | Subtitle Converter | `subtitle-converter` | 1 | client | text | — | W P |
| T02 | Subtitle Sync & Shift | `subtitle-shift` | 1 | client | text | — | W P |
| T03 | Subtitle Editor | `subtitle-editor` | 3 | client | text + timeline | — | W |
| T04 | Timecode Calculator | `timecode-calculator` | 1 | client | text | — | W M P |
| T05 | Aspect Ratio Calculator | `aspect-ratio-calculator` | 1 | client | text | — | W M P |
| T06 | Bitrate & File Size Calculator | `bitrate-calculator` | 1 | client | text | — | W M P |
| T07 | Shutter Angle Calculator | `shutter-angle-calculator` | 3 | client | text | — | W M |
| T08 | Recording Storage Calculator | `storage-calculator` | 3 | client | text | — | W M |

## Utility — `tools/utility.md`

| Code | Tool | Slug | Wave | Runtime | Engine | Server cost | Surfaces |
|---|---|---|---|---|---|---|---|
| U01 | QR Code Generator | `qr-code-generator` | 1 | client | text | — | W M |
| U02 | Batch Rename Files | `batch-rename` | 2 | client | text | — | W |
| U03 | Print Size & DPI Calculator | `dpi-calculator` | 2 | client | text | — | W M |
| U04 | File Checksum | `file-checksum` | 3 | client | file-hash | — | W |

## Conversion pair pages (programmatic SEO, Wave 1 & 2)

Generated from `packages/registry/conversions.ts`; each is a preset of P06 / V03 / A01 / V04–V06 / T01. Start with these ~30, add by search demand:

- Image: heic-to-jpg, heic-to-png, webp-to-jpg, webp-to-png, png-to-jpg, jpg-to-png, png-to-webp, jpg-to-webp, avif-to-jpg, jpg-to-avif, png-to-ico (Wave 3)
- Video: mov-to-mp4, mkv-to-mp4, webm-to-mp4, avi-to-mp4, mp4-to-webm, mp4-to-gif, mov-to-gif, gif-to-mp4
- Audio: mp4-to-mp3, mov-to-mp3, wav-to-mp3, mp3-to-wav, m4a-to-mp3, flac-to-mp3, ogg-to-mp3, mp3-to-ogg
- Subtitles: srt-to-vtt, vtt-to-srt, ass-to-srt

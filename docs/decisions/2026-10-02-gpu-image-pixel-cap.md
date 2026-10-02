# 2026-10-02 · A GPU image call decodes no bigger picture than was priced

**Decision:**
- **The worker sends the cap.** Upscale Image (P08) and Object Eraser (P17) calls carry `max_pixels`: the picture's width × height from the probe the job was priced and checked on (`processors/upscale_image.priced_pixels`).
- **The function refuses from the header.** `modal_app._read_image` reads the image's size from its own header and refuses a bigger picture before decoding a pixel (`gpu/remote.check_pixels`). The answer is `TOO_LARGE` with a sentence the web shows: the size it found, and to save the image again from an editor.
- **Refused, not cut.** A picture can't be cut short the way a clip is (`2026-10-02-gpu-decode-cap.md`). Nothing has been decoded when it's refused, so no GPU time is lost, and the job's credits come back like any failed job's.
- **Checked like the other caps:** a cap that isn't a positive whole number fails the call with `BAD_INPUT`. A missing one (a worker from before this) means the function's hard cap, 100 MP, which is also Pillow's decompression-bomb limit there. The Modal smoke calls send it.

**Why:** the last gap from the GPU decode-cap review. The worker prices an image from ffprobe's reading of its header, and Pillow reads the header again in the GPU function. A file crafted so the two read different sizes (two size markers, say) would be priced on the smaller one. It would then cost more GPU time than was paid for, up to the 64 MP output cap. A test probes real PNG, JPEG and WebP files with the worker's own probe and checks that the cap is every pixel, so an honest image is never refused.

**Reverse:** drop `max_pixels` from the two processors' options (the functions then take 100 MP), or remove the `check_pixels` call in `modal_app._read_image`.

import type { PairCopy } from './pairs';

/** Image conversion pairs (P06). HEIC pairs are held: see conversions.ts. */
export const IMAGE_PAIR_COPY: Readonly<Record<string, PairCopy>> = {
  'webp-to-jpg': {
    title: 'WebP to JPG Converter, Free and in Your Browser | EditToolbelt',
    description:
      'Convert WebP images to JPG for apps, email and older software that can’t open WebP. Transparency filled with white or black, up to 50 files at once.',
    h1: 'WebP to JPG Converter',
    tagline: 'Turn WebP images into JPG files that open everywhere, one or 50 at a time.',
    about: [
      'WebP is Google’s image format for the web: smaller than JPG at the same quality, and it can hold transparency. Browsers open it, but some photo apps, older Office versions and upload forms still don’t, and that’s when you want a JPG.',
      'JPG has no transparency, so transparent areas are filled with white or black. JPG is also lossy: at the default quality of 85 the result looks the same, and the file is usually somewhat larger than the WebP it came from.',
      'An animated WebP becomes a single JPG of its first frame.',
    ],
    howTo: [
      'Drop one or more .webp files, or choose them.',
      'JPG is already selected. Set the quality, and pick white or black for transparent areas.',
      'Select Convert. Each image is converted on your device.',
      'Download the JPG files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'Why is the JPG bigger than the WebP?',
        a: 'WebP compresses better than JPG, so the same picture usually needs more bytes as a JPG. Lower the quality to 75 or 80 if size matters, or use Compress Image to aim for a target size.',
      },
      {
        q: 'What happens to a transparent background?',
        a: 'JPG can’t store transparency, so it is filled with white by default. Choose black instead, or convert to PNG to keep the transparency.',
      },
      {
        q: 'Is the location in my photo kept?',
        a: 'No. By default the GPS location is removed and camera details are kept. Pick Remove all to drop every tag.',
      },
    ],
  },
  'webp-to-png': {
    title: 'WebP to PNG Converter, Keeps Transparency | EditToolbelt',
    description:
      'Convert WebP images to PNG with transparency kept and no added quality loss. For stickers, logos and screenshots, up to 50 files at once, in your browser.',
    h1: 'WebP to PNG Converter',
    tagline: 'Turn WebP images into lossless PNG files, with transparency kept.',
    about: [
      'PNG is the lossless format design and editing apps expect: every pixel is stored exactly, with full transparency. WebP is smaller, but not every editor or upload form accepts it.',
      'Converting to PNG adds no new loss: the pixels decoded from the WebP are saved exactly, then the PNG is optimized losslessly with OxiPNG. If the WebP itself was lossy, its compression artifacts stay as they are.',
      'PNG files are often larger than the WebP they came from, especially for photos. For a smaller photo, JPG or keeping WebP is the better choice.',
    ],
    howTo: [
      'Drop one or more .webp files, or choose them.',
      'PNG is already selected.',
      'Select Convert, then check the before and after sizes.',
      'Download the PNG files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'Is the transparency kept?',
        a: 'Yes. PNG stores full 8-bit transparency, so cut-outs, stickers and logos keep their clear background.',
      },
      {
        q: 'Why is the PNG so much larger?',
        a: 'PNG never throws detail away, so a photo that WebP squeezed into 200 KB can take several MB as PNG. For photos, JPG is usually the better target.',
      },
      {
        q: 'Can I convert an animated WebP?',
        a: 'Only its first frame is converted; the PNG is a still image.',
      },
    ],
  },
  'png-to-jpg': {
    title: 'PNG to JPG Converter, Smaller Files | EditToolbelt',
    description:
      'Convert PNG images and screenshots to JPG for much smaller files. Pick the quality and the color behind transparent areas, up to 50 files at once.',
    h1: 'PNG to JPG Converter',
    tagline: 'Turn PNG images into smaller JPG files, at the quality you choose.',
    about: [
      'PNG is lossless, which is ideal for screenshots, graphics and anything with sharp edges or transparency, but it makes photos large. JPG is built for photos: the same picture often shrinks to a fraction of the size.',
      'JPG can’t store transparency, so transparent areas become white or black. Text and hard edges can show faint halos at low quality, so keep the quality at 85 or higher for screenshots.',
      'The JPG is encoded with MozJPEG, which makes smaller files than most apps at the same quality.',
    ],
    howTo: [
      'Drop one or more .png files, or choose them.',
      'JPG is already selected. Set the quality: 85 is a good default, 90 or more for screenshots with text.',
      'Choose white or black for transparent areas, then select Convert.',
      'Download the JPG files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'How much smaller will the file be?',
        a: 'For photos, often several times smaller. For screenshots and flat graphics the gain is smaller, and PNG can even win; the result shows the exact change for each file.',
      },
      {
        q: 'Will my transparent background turn black?',
        a: 'Only if you pick black. By default transparent areas become white.',
      },
      {
        q: 'Does it keep the size in pixels?',
        a: 'Yes. Width and height stay exactly the same; use Resize Image to change them.',
      },
    ],
  },
  'jpg-to-png': {
    title: 'JPG to PNG Converter, Free and Lossless | EditToolbelt',
    description:
      'Convert JPG photos to PNG for editing apps and uploads that ask for PNG. No extra quality loss, up to 50 files at once, and nothing leaves your device.',
    h1: 'JPG to PNG Converter',
    tagline: 'Turn JPG photos into PNG files for editors and forms that need PNG.',
    about: [
      'Some editors, print services and upload forms ask for PNG. Converting a JPG gives exactly that: a lossless copy of the picture, so later edits don’t add another round of JPG compression each time you save.',
      'Converting can’t bring back detail the JPG already lost, and it doesn’t add transparency: the background stays as it is.',
      'PNG copies of photos are several times larger than the JPG. The PNG is optimized losslessly with OxiPNG to keep it as small as it can be.',
    ],
    howTo: [
      'Drop one or more .jpg or .jpeg files, or choose them.',
      'PNG is already selected.',
      'Choose whether to keep camera details. The GPS location is removed either way.',
      'Select Convert, then download each PNG or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'Does converting to PNG improve quality?',
        a: 'No. It stops further loss, but detail the JPG already dropped stays lost. The PNG looks exactly like the JPG.',
      },
      {
        q: 'Will the background become transparent?',
        a: 'No. A JPG has no transparency to keep, so the PNG has the same background as the photo.',
      },
      {
        q: 'Is the photo turned the right way?',
        a: 'Yes. The orientation the camera stored is applied to the pixels, so the PNG shows the photo the right way up everywhere.',
      },
    ],
  },
  'png-to-webp': {
    title: 'PNG to WebP Converter, Smaller Web Images | EditToolbelt',
    description:
      'Convert PNG images to WebP for faster websites: much smaller files with transparency kept. Pick the quality, up to 50 files at once, in your browser.',
    h1: 'PNG to WebP Converter',
    tagline: 'Turn PNG images into much smaller WebP files for the web, transparency kept.',
    about: [
      'WebP is made for websites: it keeps transparency like PNG but compresses far better, which makes pages load faster. Every current browser opens it.',
      'The conversion uses lossy WebP at the quality you choose. At 85, logos and interface graphics still look sharp; for pixel-exact graphics such as pixel art, keep the PNG.',
      'Transparent areas stay transparent, with the edges stored at full alpha quality.',
    ],
    howTo: [
      'Drop one or more .png files, or choose them.',
      'WebP is already selected. Set the quality: 85 is a good default.',
      'Select Convert and compare the sizes.',
      'Download the WebP files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'How much smaller is WebP than PNG?',
        a: 'For photos and gradients, usually several times smaller. For flat graphics with few colors the gain is smaller; the result shows the exact change for each file.',
      },
      {
        q: 'Is transparency kept?',
        a: 'Yes. WebP stores transparency, and the edges are kept at full alpha quality.',
      },
      {
        q: 'Will every browser show WebP?',
        a: 'Every current version of Chrome, Safari, Firefox and Edge does. Very old browsers and some email apps don’t; use JPG or PNG there.',
      },
    ],
  },
  'jpg-to-webp': {
    title: 'JPG to WebP Converter, Faster Web Images | EditToolbelt',
    description:
      'Convert JPG photos to WebP for smaller files at the same visual quality, ready for websites and web apps. Up to 50 files at once, in your browser.',
    h1: 'JPG to WebP Converter',
    tagline: 'Turn JPG photos into smaller WebP files for websites.',
    about: [
      'WebP usually stores a photo in fewer bytes than JPG at the same visual quality, which makes web pages lighter. Every current browser supports it, and so do most site builders.',
      'Re-encoding a JPG adds a second round of lossy compression, so keep the quality at 80 or more. The result shows the size change, and the slider compares before and after.',
      'Camera details stay in the WebP file without the GPS location, unless you choose to remove all metadata.',
    ],
    howTo: [
      'Drop one or more .jpg or .jpeg files, or choose them.',
      'WebP is already selected. Keep the quality at 80 or higher.',
      'Select Convert and compare before and after with the slider.',
      'Download the WebP files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'Is WebP always smaller than JPG?',
        a: 'Usually, but not always: a JPG that was already heavily compressed may not shrink much, and at a very high quality the WebP can even be larger. Each result shows the exact change.',
      },
      {
        q: 'Can I use WebP on my website?',
        a: 'Yes. All current browsers support it, and most platforms, WordPress included, accept WebP uploads.',
      },
      {
        q: 'What about AVIF?',
        a: 'AVIF is often smaller still, but slower to encode. Pick AVIF in the Image Converter if every byte counts.',
      },
    ],
  },
  'avif-to-jpg': {
    title: 'AVIF to JPG Converter, Free and in Your Browser | EditToolbelt',
    description:
      'Convert AVIF images to JPG for apps, editors and sites that don’t support AVIF yet. Transparency filled with white or black, up to 50 files at once.',
    h1: 'AVIF to JPG Converter',
    tagline: 'Turn AVIF images into JPG files that every app can open.',
    about: [
      'AVIF is a newer image format built on the AV1 video codec. It makes very small files and browsers open it, but many photo apps, older systems and upload forms still don’t.',
      'Your browser decodes the AVIF, and the image is saved as a JPG at the quality you pick. Expect the JPG to be larger than the AVIF, since AVIF compresses much better.',
      'AVIF can hold transparency and wide colors. JPG can’t hold transparency, so those areas become white or black, and colors are converted to sRGB, the space every screen and app expects.',
    ],
    howTo: [
      'Drop one or more .avif files, or choose them.',
      'JPG is already selected. Set the quality and the color for transparent areas.',
      'Select Convert. Each image is converted on your device.',
      'Download the JPG files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'The tool says it can’t read my AVIF. Why?',
        a: 'It uses your browser to decode AVIF. Current Chrome, Firefox, Safari and Edge all can; an older browser may not, and updating it fixes that.',
      },
      {
        q: 'Why is the JPG so much bigger?',
        a: 'AVIF compresses far better than JPG, often by half or more at the same quality. The larger JPG is the price of opening everywhere.',
      },
      {
        q: 'Are HDR AVIF images supported?',
        a: 'They are converted to standard 8-bit sRGB, so the brightest highlights are clipped. The picture itself is kept.',
      },
    ],
  },
  'jpg-to-avif': {
    title: 'JPG to AVIF Converter, Smallest Web Images | EditToolbelt',
    description:
      'Convert JPG photos to AVIF, often half the size of JPG at the same visual quality. Encoded on your device with libavif, up to 50 files at once.',
    h1: 'JPG to AVIF Converter',
    tagline: 'Turn JPG photos into AVIF, the smallest widely supported web image format.',
    about: [
      'AVIF comes from the AV1 video codec and usually makes the smallest photo files of any format browsers support, which makes it a strong choice for fast websites.',
      'AVIF takes longer to encode than JPG or WebP: a 12 MP photo can take several seconds, all on your device. The quality slider is matched to JPG’s scale, and 85 keeps photos clean.',
      'Every current browser opens AVIF. Some image editors and older phones don’t yet, so keep the original JPG too.',
    ],
    howTo: [
      'Drop one or more .jpg or .jpeg files, or choose them.',
      'AVIF is already selected. 85 is a good quality for photos.',
      'Select Convert. Encoding takes a few seconds per photo.',
      'Download the AVIF files one by one or in one ZIP.',
    ],
    faq: [
      {
        q: 'How much smaller is AVIF than JPG?',
        a: 'Often about half the size at the same visual quality, sometimes less. Each result shows the exact change.',
      },
      {
        q: 'Why does it take longer than other formats?',
        a: 'The AVIF encoder searches harder for a compact encoding. It runs on your device, so the time depends on your processor.',
      },
      {
        q: 'Can every browser show AVIF?',
        a: 'Current Chrome, Firefox, Safari (16 and later) and Edge all can. For email or very old devices, JPG is still the safe choice.',
      },
    ],
  },
};

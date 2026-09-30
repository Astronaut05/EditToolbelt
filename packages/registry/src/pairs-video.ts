import type { PairCopy } from './pairs';

/** Copy for the video pair pages (docs/09 → URL scheme): each written for its pair. */
export const VIDEO_PAIR_COPY: Readonly<Record<string, PairCopy>> = {
  'mp4-to-gif': {
    title: 'MP4 to GIF Converter, Pick the Range and Size | EditToolbelt',
    description:
      'Turn part of an MP4 into an animated GIF: choose the seconds, frame rate and width, and see the size first. Free, in your browser, no watermark.',
    h1: 'MP4 to GIF Converter',
    tagline: 'Pick a few seconds of an MP4 and turn them into a looping GIF.',
    about: [
      'MP4 holds video with modern compression, so a minute can be a few megabytes. GIF is a 1980s image format that plays frames in a loop: no sound, 256 colors, and far bigger per second, but it plays anywhere an image can, from chats to email to docs.',
      'The frames you choose are decoded from the MP4 at the rate you set, one palette of 255 colors is built for the whole clip, and each frame is mapped to it with dithering to keep gradients smooth. Pixels that don’t change from one frame to the next are left out, which is what keeps a GIF of a talking head small.',
      'Keep it short: 3 to 6 seconds at 480 px and 12 fps usually lands between 2 and 8 MB.',
    ],
    howTo: [
      'Drop an MP4.',
      'Drag the In and Out handles over the moment you want; the first 5 seconds are selected to start.',
      'Check the estimate, and lower the width or frame rate if it’s over your limit.',
      'Select Make GIF and download it.',
    ],
    faq: [
      {
        q: 'Why is the GIF bigger than the MP4?',
        a: 'GIF compresses each frame on its own and can only store 256 colors, while MP4 predicts frames from each other. A GIF is often 5 to 10 times the size per second. For the web, animated WebP or the MP4 itself is lighter.',
      },
      {
        q: 'Is the sound kept?',
        a: 'No, GIFs have no sound. To keep audio, trim the MP4 instead.',
      },
      {
        q: 'Can I make it play faster?',
        a: 'Yes. Speed 1.5× or 2× samples the clip faster while the GIF plays at the frame rate you set, so it runs quicker and ends up smaller.',
      },
    ],
  },
  'mov-to-gif': {
    title: 'MOV to GIF Converter, iPhone Videos to GIF | EditToolbelt',
    description:
      'Make a GIF from a MOV recorded on an iPhone or exported from QuickTime or Final Cut. Choose the moment, fps and width. Runs in your browser.',
    h1: 'MOV to GIF Converter',
    tagline: 'Turn a moment from an iPhone or QuickTime MOV into a looping GIF.',
    about: [
      'MOV is the QuickTime format iPhones record and Macs export, usually H.264 or HEVC video. A GIF made from it plays in any chat, email or page without a video player.',
      'Portrait phone videos stay portrait: the width you pick is the GIF’s width, so a vertical clip at 480 px becomes 480 × 853. Your browser decodes the frames, so HEVC MOVs need Safari, or Chrome or Edge on a device that plays HEVC.',
      'For screen recordings from QuickTime, turn Dithering off: flat colors and text stay crisper and the GIF gets smaller.',
    ],
    howTo: [
      'Drop a MOV. On an iPhone, open this page in Safari and choose the video from Photos.',
      'Select the seconds you want on the timeline.',
      'Pick frame rate and width, and Dithering off for screen recordings.',
      'Select Make GIF, then download or share it.',
    ],
    faq: [
      {
        q: 'Why does my HEVC video show a warning?',
        a: 'This browser can’t decode HEVC, so it can’t read the frames. Safari on a Mac or iPhone can, and so can Chrome and Edge on devices with HEVC hardware.',
      },
      {
        q: 'How long can the GIF be?',
        a: 'Up to 600 frames: 50 seconds at 12 fps. Past a few seconds a GIF gets large, so the estimate warns above 15 MB.',
      },
      {
        q: 'Can I get a Live Photo as a GIF?',
        a: 'Export the Live Photo as a video first (in Photos, Share > Save as Video), then drop that MOV here.',
      },
    ],
  },
  'mp4-to-mp3': {
    title: 'MP4 to MP3 Converter, Free and in Your Browser | EditToolbelt',
    description:
      'Save the sound of an MP4 video as an MP3, up to 320 kbps. Made on your device: no upload, no sign-up, no watermark, up to 2 GB.',
    h1: 'MP4 to MP3 Converter',
    tagline: 'Keep just the sound of an MP4 video, as an MP3 that plays everywhere.',
    about: [
      'An MP4 file holds a video track and, almost always, an AAC audio track: the format phones, cameras and screen recorders use. MP3 is the older audio format every player, car stereo and editing app still reads.',
      'The AAC audio is decoded and encoded as MP3 with the LAME encoder, at 192 kbps unless you pick 128, 256 or 320. The video is left out, so the MP3 is a fraction of the size.',
      'If you want the sound without any re-encoding, pick M4A instead: it copies the AAC audio as it is, and most players open it too.',
    ],
    howTo: [
      'Drop an MP4, or choose one. Up to 2 GB.',
      'MP3 is already selected. Pick a bitrate: 192 kbps suits music and speech alike.',
      'Select Extract audio. A 10-minute video takes a few seconds.',
      'Listen to the result, then download the MP3.',
    ],
    faq: [
      {
        q: 'Will the MP3 sound worse than the video?',
        a: 'Both AAC and MP3 are lossy, so converting adds a little loss. At 192 kbps or more, most people can’t hear it. For an exact copy, choose M4A.',
      },
      {
        q: 'How big will the MP3 be?',
        a: 'About 1.4 MB per minute at 192 kbps, and 2.4 MB per minute at 320 kbps, whatever the size of the video.',
      },
      {
        q: 'Can I convert only part of the video?',
        a: 'Trim the video first with Trim Video, then extract the audio from the trimmed clip.',
      },
    ],
  },
  'mov-to-mp3': {
    title: 'MOV to MP3 Converter, iPhone Videos to MP3 | EditToolbelt',
    description:
      'Turn the sound of a MOV video from an iPhone, Mac or camera into an MP3. Runs in your browser, so the video never leaves your device.',
    h1: 'MOV to MP3 Converter',
    tagline: 'Pull the audio out of an iPhone or QuickTime MOV and save it as an MP3.',
    about: [
      'MOV is Apple’s QuickTime format: iPhones record in it, and Final Cut and many cameras export it. Inside is usually H.264 or HEVC video with AAC sound, sometimes with extra tracks for a second microphone.',
      'Only the sound is read, so HEVC video that some browsers can’t decode is no problem here. The AAC audio is encoded as MP3 at the bitrate you pick, and the result plays on anything.',
      'When a MOV has more than one audio track, an Audio track choice lists them, so you can take the one you need.',
    ],
    howTo: [
      'Drop a MOV from your iPhone, Mac or camera. AirDrop it to a Mac first, or open this page on the iPhone itself.',
      'MP3 is already selected; pick a bitrate, and a track if there are several.',
      'Select Extract audio.',
      'Play it back, then download the MP3.',
    ],
    faq: [
      {
        q: 'Does it work with iPhone videos in HEVC?',
        a: 'Yes. The video track is never decoded, only the audio, which is AAC on every iPhone.',
      },
      {
        q: 'Can I do this on the iPhone itself?',
        a: 'Yes, in Safari. Choose the video from Photos or Files, and the MP3 saves to Files.',
      },
      {
        q: 'What about spatial audio or several microphones?',
        a: 'Each audio track is listed separately. The MP3 is stereo, so surround tracks are mixed down to two channels.',
      },
    ],
  },
  'mov-to-mp4': {
    title: 'MOV to MP4 Converter, Instant and Lossless | EditToolbelt',
    description:
      'Turn iPhone and QuickTime MOV files into MP4 in seconds. H.264 and HEVC are remuxed, not re-encoded, so the quality is exactly the same. In your browser.',
    h1: 'MOV to MP4 Converter',
    tagline: 'Change an iPhone or QuickTime MOV into an MP4 that plays and uploads everywhere.',
    about: [
      'MOV is Apple’s QuickTime format: iPhones, Macs and Final Cut write it. MP4 grew out of it, and the two usually hold the very same H.264 or HEVC video and AAC audio. Some upload forms, Windows apps and older TVs still only take MP4.',
      'When the tracks already fit MP4, they are remuxed: moved into the new container as they are, with nothing re-encoded. It takes a moment even for a long clip, and every frame stays byte for byte the same. Only codecs MP4 can’t carry are re-encoded.',
      'ProRes from a camera or an editor needs our server converter, which isn’t ready yet; this page says so if you drop one.',
    ],
    howTo: [
      'Drop a MOV. On an iPhone, pick it from Photos or Files.',
      'MP4 is already selected, with Keep quality: it remuxes whenever it can.',
      'Select Convert, then download the MP4.',
    ],
    faq: [
      {
        q: 'Does converting MOV to MP4 lower the quality?',
        a: 'Not when it remuxes, which is the usual case for iPhone video: the frames are copied, not re-encoded. The result says which happened.',
      },
      {
        q: 'Will HDR and Dolby Vision from an iPhone survive?',
        a: 'The HEVC video is copied as it is, with its HDR tags. Players that understand HDR in MP4 show it as HDR.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is converted in your browser, up to 2 GB.',
      },
    ],
  },
  'mkv-to-mp4': {
    title: 'MKV to MP4 Converter, Remux Without Re-encoding | EditToolbelt',
    description:
      'Convert MKV to MP4 for phones, TVs and editors. H.264 or HEVC is remuxed losslessly; VP9 is re-encoded to H.264. Free, in your browser.',
    h1: 'MKV to MP4 Converter',
    tagline: 'Make an MKV play on phones, TVs, iMovie and Premiere by moving it into MP4.',
    about: [
      'MKV (Matroska) is an open container that holds almost any codec, which is why screen recorders like OBS and many downloads use it. Phones, smart TVs and editing apps often refuse it, even when the video inside is ordinary H.264.',
      'If the video is H.264 or HEVC and the audio AAC, MP3 or AC-3, the tracks are remuxed into MP4 with nothing re-encoded. VP9, or Opus and Vorbis audio, don’t play in MP4 on Apple devices and in editors, so those are re-encoded to H.264 and AAC.',
      'Recording in OBS? Its remux feature does the same for MKV files you made there.',
    ],
    howTo: [
      'Drop an MKV.',
      'MP4 is already selected, with Keep quality.',
      'Select Convert. The result says whether it remuxed or re-encoded.',
    ],
    faq: [
      {
        q: 'Why was my MKV re-encoded instead of remuxed?',
        a: 'Its video is VP9 or AV1 or its audio is Opus or Vorbis, which MP4 files can hold but Apple devices and editing apps don’t play. Re-encoding makes an MP4 that plays everywhere.',
      },
      {
        q: 'Are subtitles and extra audio tracks kept?',
        a: 'The main video and audio are converted. Extra tracks are left out, and the result lists them.',
      },
      {
        q: 'Is my file uploaded?',
        a: 'No, the conversion runs in your browser.',
      },
    ],
  },
  'webm-to-mp4': {
    title: 'WebM to MP4 Converter, VP9 to H.264 | EditToolbelt',
    description:
      'Convert WebM video, from screen recorders and the web, to MP4 with H.264 so it plays on iPhones and imports into editors. In your browser.',
    h1: 'WebM to MP4 Converter',
    tagline: 'Turn WebM recordings and downloads into MP4 that iPhones and editors accept.',
    about: [
      'WebM is the web’s open video format: VP8, VP9 or AV1 video with Opus or Vorbis audio. Browser screen recorders and many sites save it. Apple devices, Premiere and Final Cut often won’t take it.',
      'VP9 and Opus don’t belong in an MP4 that has to play everywhere, so the video is re-encoded to H.264 and the audio to AAC, at high quality. That takes a while for a long video; the progress bar shows how long.',
      'If this browser can’t encode H.264 (Firefox on some systems), the result says so and offers WebM.',
    ],
    howTo: ['Drop a WebM.', 'MP4 is already selected.', 'Select Convert and download the MP4.'],
    faq: [
      {
        q: 'How long does it take?',
        a: 'Re-encoding runs at about real time or faster on a laptop, using the hardware encoder where there is one.',
      },
      {
        q: 'Is quality lost?',
        a: 'Re-encoding at high quality keeps it visually the same for most video; it is a new encode, not a copy.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. Everything runs in your browser.',
      },
    ],
  },
  'mp4-to-webm': {
    title: 'MP4 to WebM Converter, VP9 for the Web | EditToolbelt',
    description:
      'Convert MP4 to WebM with VP9 video and Opus audio, the open format for websites and HTML5 video. Free and private, in your browser.',
    h1: 'MP4 to WebM Converter',
    tagline: 'Make a WebM with VP9 and Opus for a website, a game or an HTML5 player.',
    about: [
      'WebM is open and royalty-free, and every current browser plays it. Sites use it for background and product videos; VP9 is usually smaller than H.264 at the same quality.',
      'The video is re-encoded to VP9 and the audio to Opus, at high quality. An MP4 that already holds VP9 or AV1 with Opus is remuxed instead, with nothing re-encoded.',
      'For the widest reach, publish both: WebM for browsers, MP4 as the fallback.',
    ],
    howTo: ['Drop an MP4.', 'WebM is already selected.', 'Select Convert and download the WebM.'],
    faq: [
      {
        q: 'Is WebM smaller than MP4?',
        a: 'VP9 is often a little smaller than H.264 at the same quality. For a smaller file of either, use Compress Video.',
      },
      {
        q: 'Does Safari play WebM?',
        a: 'Current Safari on macOS and iOS plays VP9 WebM. Older versions don’t, so keep an MP4 as a fallback.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No. It is converted in your browser.',
      },
    ],
  },
};

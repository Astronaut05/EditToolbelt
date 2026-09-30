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
};

import type { PairCopy } from './pairs';

/** Copy for the audio pair pages (docs/09 → URL scheme): each written for its pair. */
export const AUDIO_PAIR_COPY: Readonly<Record<string, PairCopy>> = {
  'wav-to-mp3': {
    title: 'WAV to MP3 Converter, Up to 320 kbps | EditToolbelt',
    description:
      'Shrink WAV recordings into MP3s that play everywhere, at 128 to 320 kbps. Converted on your device: no upload, no sign-up, batches at once.',
    h1: 'WAV to MP3 Converter',
    tagline: 'Turn big WAV files into small MP3s for sharing, email or the web.',
    about: [
      'WAV is uncompressed audio: what recorders, DAWs and sound libraries use, and about 10 MB a minute at CD quality. MP3 compresses it roughly tenfold, so a 50 MB voice-over becomes 5 MB and still plays on every phone, car and browser.',
      'The WAV is read as it is, then encoded with the LAME encoder at the bitrate you pick. 192 kbps is transparent for speech and most music; 320 kbps is the most MP3 can hold. The sample rate and channels stay unless you change them.',
      'Keep the WAV for editing: every MP3 generation loses a little, so convert once, at the end.',
    ],
    howTo: [
      'Drop one WAV or a batch of them.',
      'MP3 is already selected. Pick a bitrate: 192 kbps suits speech and music alike.',
      'Select Convert, then download each MP3 or all of them in one ZIP.',
    ],
    faq: [
      {
        q: 'How much smaller is the MP3?',
        a: 'At 192 kbps, about 1.4 MB a minute, against 10 MB for a stereo 44.1 kHz WAV: roughly a seventh. At 128 kbps it is about a tenth.',
      },
      {
        q: 'Does 24-bit or 96 kHz WAV work?',
        a: 'Yes. MP3 tops out at 48 kHz, so pick 48 kHz or 44.1 kHz under Sample rate; the extra depth is kept in the encode and then rounded off, as MP3 always does.',
      },
      {
        q: 'Are my files uploaded?',
        a: 'No. They are converted in your browser, and nothing leaves your device.',
      },
    ],
  },
  'mp3-to-wav': {
    title: 'MP3 to WAV Converter, 16 or 24-bit | EditToolbelt',
    description:
      'Convert MP3 to WAV for editors, samplers and CD burning: 16 or 24-bit, 44.1 or 48 kHz. Free, in your browser, several files at once.',
    h1: 'MP3 to WAV Converter',
    tagline: 'Unpack MP3s into WAV for editing software, samplers and hardware that need PCM.',
    about: [
      'Some tools only take WAV: older editors, hardware samplers, CD burning software, broadcast systems. Converting decodes the MP3 into plain PCM samples that any of them read.',
      'The WAV sounds exactly like the MP3, no better: what the MP3 dropped is gone. It is just easier to edit, since every sample is there to cut on, with no decoder delay.',
      'For video, pick 48 kHz: it is what timelines run at, and it saves a resample later.',
    ],
    howTo: [
      'Drop one MP3 or a batch.',
      'WAV is already selected. Pick 16-bit (CD) or 24-bit, and 48 kHz if the sound is going into a video.',
      'Select Convert, then download the WAV files.',
    ],
    faq: [
      {
        q: 'Will the WAV sound better than the MP3?',
        a: 'No. Converting cannot bring back what MP3 compression removed. The WAV is bigger because it is uncompressed, not because it holds more.',
      },
      {
        q: 'Why is there a little silence at the start?',
        a: 'MP3 encoders add a few milliseconds of padding. Players that read the MP3’s gapless info hide it; the WAV shows it. Trim Audio removes it if it matters.',
      },
      {
        q: 'How big will the WAV be?',
        a: 'About 10 MB a minute for 16-bit stereo at 44.1 kHz, and 16.5 MB a minute for 24-bit at 48 kHz.',
      },
    ],
  },
  'm4a-to-mp3': {
    title: 'M4A to MP3 Converter, iPhone Voice Memos to MP3 | EditToolbelt',
    description:
      'Convert M4A from iPhone Voice Memos, iTunes or GarageBand to MP3. Runs in your browser: no upload, no sign-up, batches at once.',
    h1: 'M4A to MP3 Converter',
    tagline: 'Turn iPhone voice memos and iTunes audio into MP3s that play anywhere.',
    about: [
      'M4A is AAC audio in an MP4 container: what iPhone Voice Memos, iTunes and GarageBand export. It is small and sounds good, but some older players, car stereos and upload forms only take MP3.',
      'The AAC audio is decoded and encoded as MP3 at the bitrate you pick. Voice memos are mono, so 128 kbps is plenty; for music pick 192 kbps or more.',
      'Tags such as title, artist and album are carried over where both formats have them.',
    ],
    howTo: [
      'Drop your M4A files. On an iPhone, share a voice memo to Files first, then choose it here in Safari.',
      'MP3 is already selected. 128 kbps suits voice memos; 192 kbps suits music.',
      'Select Convert and download the MP3s.',
    ],
    faq: [
      {
        q: 'Why does it say this browser can’t decode AAC?',
        a: 'Some browsers, depending on the system, can’t decode AAC. Chrome, Edge and Safari on Windows, macOS, iOS and Android can; try one of those.',
      },
      {
        q: 'Does it work with Apple Lossless (ALAC) M4A?',
        a: 'Only if your browser can decode Apple Lossless. If it can’t, you’ll see a message saying so, and nothing is converted.',
      },
      {
        q: 'Are protected iTunes songs supported?',
        a: 'No. Songs with DRM (the old .m4p files) cannot be decoded by any browser.',
      },
    ],
  },
  'flac-to-mp3': {
    title: 'FLAC to MP3 Converter, 320 kbps | EditToolbelt',
    description:
      'Convert lossless FLAC to MP3 for phones, cars and players without FLAC support, at up to 320 kbps. Free and private, in your browser.',
    h1: 'FLAC to MP3 Converter',
    tagline: 'Make MP3 copies of lossless FLAC music for phones, cars and players.',
    about: [
      'FLAC is lossless: it compresses audio like a ZIP file does, with every sample kept, at about half the size of WAV. It is the format for archiving and for listening at home, but plenty of car stereos and older players do not read it.',
      'Converting to MP3 at 320 kbps makes files about a third the size of the FLAC and indistinguishable for most listening. Keep the FLAC as your master and make MP3s from it whenever you need them.',
      'Hi-res FLAC (24-bit, 96 kHz) is fine: pick 48 kHz or 44.1 kHz for the MP3.',
    ],
    howTo: [
      'Drop FLAC files, a whole album at once if you like.',
      'Pick 320 kbps for the best MP3, or 192 kbps to save space.',
      'Select Convert, then download all of them as one ZIP.',
    ],
    faq: [
      {
        q: 'Is 320 kbps MP3 as good as FLAC?',
        a: 'Not bit for bit, but in blind tests most people cannot tell them apart. FLAC is still the one to keep, because every re-encode from an MP3 loses more.',
      },
      {
        q: 'Are tags and cover art kept?',
        a: 'Text tags such as title, artist and album are carried over. Check cover art after converting, as not every player shows it.',
      },
      {
        q: 'How long does an album take?',
        a: 'A few seconds a track on a laptop, one after another. Nothing is uploaded, so it does not depend on your connection.',
      },
    ],
  },
  'ogg-to-mp3': {
    title: 'OGG to MP3 Converter, Vorbis and Opus | EditToolbelt',
    description:
      'Convert OGG Vorbis or Opus audio, from games, Discord or Telegram, to MP3 that plays everywhere. In your browser, no upload.',
    h1: 'OGG to MP3 Converter',
    tagline: 'Turn OGG files from games, voice apps and Linux tools into MP3.',
    about: [
      'OGG is a container that usually holds Vorbis (games, Linux, Spotify’s cache) or Opus (Discord, Telegram and WhatsApp voice notes). Both sound good at low bitrates, but many editors, phones and websites still only take MP3.',
      'The audio is decoded and encoded as MP3. Voice notes are small, so 128 kbps keeps them clear; for music pick 192 kbps or more.',
      'Opus runs at 48 kHz, which MP3 supports, so nothing is resampled unless you ask for it.',
    ],
    howTo: [
      'Drop OGG or OGA files, one or many.',
      'MP3 is already selected. Pick a bitrate.',
      'Select Convert, then download the MP3s.',
    ],
    faq: [
      {
        q: 'My voice note is .opus, not .ogg. Does that work?',
        a: 'Yes, .opus files are OGG files with Opus inside. Drop them the same way.',
      },
      {
        q: 'Will the MP3 be bigger?',
        a: 'Usually, yes. Opus voice notes are often 16 to 32 kbps; an MP3 needs more to sound as good. 128 kbps is a safe choice for speech.',
      },
      {
        q: 'Is anything uploaded?',
        a: 'No, the conversion happens in your browser.',
      },
    ],
  },
  'mp3-to-ogg': {
    title: 'MP3 to OGG Converter, Opus for Games and Web | EditToolbelt',
    description:
      'Convert MP3 to OGG with Opus audio: smaller files for games, web apps and Discord bots. Free, in your browser, batches at once.',
    h1: 'MP3 to OGG Converter',
    tagline: 'Make small OGG Opus files from MP3 for games, web apps and bots.',
    about: [
      'OGG with Opus is the format of choice for game engines such as Godot, web apps and Discord bots: open, royalty-free and very efficient, with good sound at 96 kbps and clear speech at 32 kbps.',
      'The MP3 is decoded and encoded as Opus in an OGG file, at 48 kHz, the rate Opus always runs at. Pick the bitrate by use: 64 to 96 kbps for music, 32 to 48 kbps for voice.',
      'Converting from MP3 adds a second generation of loss, so if you have the original WAV or FLAC, convert from that instead.',
    ],
    howTo: [
      'Drop MP3 files.',
      'OGG is already selected. Pick a bitrate for music or voice.',
      'Select Convert and download the OGG files.',
    ],
    faq: [
      {
        q: 'Why Opus and not Vorbis?',
        a: 'Opus sounds better at the same size, and every current browser, game engine and Discord plays it. Vorbis is older and needs more bits.',
      },
      {
        q: 'Why is it 48 kHz?',
        a: 'Opus always runs at 48 kHz inside. Players handle it without you noticing.',
      },
      {
        q: 'Which browsers can make OGG?',
        a: 'Chrome, Edge and Firefox encode Opus. Safari does not yet; there, pick another format.',
      },
    ],
  },
};

import type { CategoryId } from './schema';

export interface Category {
  id: CategoryId;
  /** Nav label and breadcrumb. */
  name: string;
  /** Hub URL: /photo (docs/09 → URL scheme). */
  slug: string;
  /** Uppercase mono tag on lists ("PHOTO", "TIME"). */
  tag: string;
  /** Hub H1. */
  title: string;
  /** Hub lead paragraph. */
  lead: string;
  /** Hub <title> and meta description. */
  seoTitle: string;
  seoDescription: string;
}

export const categories: readonly Category[] = [
  {
    id: 'photo',
    name: 'Photo',
    slug: 'photo',
    tag: 'photo',
    title: 'Photo tools',
    lead: 'Crop, resize, convert and clean up images. Most tools run in your browser, so your photos never leave your device.',
    seoTitle: 'Free Photo Tools in Your Browser | EditToolbelt',
    seoDescription:
      'Crop, resize, compress, convert and remove backgrounds from images. Most tools run in your browser, so your photos never leave your device.',
  },
  {
    id: 'video',
    name: 'Video',
    slug: 'video',
    tag: 'video',
    title: 'Video tools',
    lead: 'Trim, compress, convert and turn clips into GIFs. Browser tools use your device’s own encoder, so nothing is uploaded.',
    seoTitle: 'Free Video Tools in Your Browser | EditToolbelt',
    seoDescription:
      'Trim, compress and convert videos, make GIFs and extract audio. Browser tools use your device’s encoder, so your footage stays on your device.',
  },
  {
    id: 'audio',
    name: 'Audio',
    slug: 'audio',
    tag: 'audio',
    title: 'Audio tools',
    lead: 'Convert, trim, measure and fix audio. Loudness in LUFS, tempo in BPM, and the heavy AI jobs on our servers when you need them.',
    seoTitle: 'Free Audio Tools: Convert, Trim, BPM | EditToolbelt',
    seoDescription:
      'Convert and trim audio, find BPM and key, measure loudness in LUFS and split stems. Browser tools keep your audio on your device.',
  },
  {
    id: 'color',
    name: 'Color',
    slug: 'color',
    tag: 'color',
    title: 'Color tools',
    lead: 'Pick colors from images, build palettes, convert between HEX, RGB, HSL and more, and preview LUTs on a still.',
    seoTitle: 'Color Tools: Picker, Palette, Converter | EditToolbelt',
    seoDescription:
      'Pick colors from an image, extract a palette, convert HEX, RGB and HSL, check contrast and preview LUTs, all in your browser.',
  },
  {
    id: 'subtitles-time',
    name: 'Subtitles & Time',
    slug: 'subtitles-time',
    tag: 'time',
    title: 'Subtitle and time tools',
    lead: 'Convert and shift subtitles, and the calculators editors keep open: timecode, aspect ratio, bitrate and storage.',
    seoTitle: 'Subtitle Tools and Timecode Calculators | EditToolbelt',
    seoDescription:
      'Convert SRT, VTT and ASS subtitles, shift timing, and calculate timecode, aspect ratio, bitrate and recording storage.',
  },
  {
    id: 'utility',
    name: 'Utility',
    slug: 'utility',
    tag: 'utility',
    title: 'Utility tools',
    lead: 'Small jobs around the edit: QR codes, batch renaming, print size and DPI, file checksums.',
    seoTitle: 'Utility Tools: QR Codes, Batch Rename, DPI | EditToolbelt',
    seoDescription:
      'Make QR codes that never expire, rename files in batches, work out print size and DPI, and verify file checksums.',
  },
];

export function getCategory(id: CategoryId): Category {
  const category = categories.find((candidate) => candidate.id === id);
  if (!category) throw new Error(`Unknown category: ${id}`);
  return category;
}

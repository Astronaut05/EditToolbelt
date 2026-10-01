import { defineTool } from '../../define';

export default defineTool({
  id: 'batch-rename',
  code: 'U02',
  slug: 'batch-rename',
  category: 'utility',
  name: 'Batch Rename Files',
  tagline: 'Rename many files at once with prefixes, counters, find and replace, and dates.',
  summary: 'Rule-based renaming with live preview',
  status: 'beta',
  wave: 2,
  runtime: 'client',
  engines: ['text'],
  ui: 'batch',
  batch: true,
  // Any file: only its name changes.
  accepts: ['*/*'],
  outputs: ['zip'],
  limits: { client: { maxBytes: 4 * 1024 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  desktopBest: true,
  seo: {
    title: 'Batch Rename Files Online, by Date or Counter | EditToolbelt',
    description:
      'Rename many files with prefixes, counters, find and replace, regex, case and EXIF dates. Check every new name in a live preview before anything changes.',
    h1: 'Batch Rename Files Online',
    primaryQuery: 'batch rename files online',
    secondaryQueries: ['bulk rename files', 'rename photos by date'],
    howTo: [
      'Drop the files to rename, up to 1,000, or open a folder in Chrome or Edge on a computer.',
      'Set the rules: find and replace, remove, case, prefix and suffix, the date, a counter and the extension.',
      'Check the new names in the list. Names that clash or that a disk won’t take are flagged and stop the rename.',
      'Download the renamed copies as a ZIP, or rename the files in the folder where they are, with undo.',
    ],
    faq: [
      {
        q: 'Are my files uploaded?',
        a: 'No. The names are worked out in this browser and the files never leave your device. A ZIP holds your files exactly as they were, under their new names.',
      },
      {
        q: 'Can I rename photos by the date they were taken?',
        a: 'Yes. Pick Date taken: it is read from the photo’s EXIF (JPG, PNG, WebP, TIFF) or the clip’s own header (MP4, MOV). A file without one uses its modified date, and the list says so.',
      },
      {
        q: 'Can I undo a rename in a folder?',
        a: 'Yes, while the page is open. The files are first given temporary names and then their new ones, so names that swap never clash; if one fails, all of them go back.',
      },
    ],
  },
  related: ['file-checksum', 'exif-remover', 'image-converter'],
  willDo: [
    'Chain rules: prefix, suffix, counter, find and replace or regex, case, date and extension',
    'Check old and new names side by side, with duplicate names flagged before you confirm',
    'Rename in place in desktop Chromium browsers, or download renamed copies as a ZIP',
  ],
});

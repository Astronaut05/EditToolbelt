import { defineTool } from '../../define';

export default defineTool({
  id: 'batch-rename',
  code: 'U02',
  slug: 'batch-rename',
  category: 'utility',
  name: 'Batch Rename Files',
  tagline: 'Rename many files at once with prefixes, counters, find and replace, and dates.',
  summary: 'Rule-based renaming with live preview',
  status: 'soon',
  wave: 2,
  runtime: 'client',
  engines: ['text'],
  ui: 'batch',
  batch: true,
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
  },
  related: ['file-checksum', 'exif-remover', 'image-converter'],
  willDo: [
    'Chain rules: prefix, suffix, counter, find and replace or regex, case, date and extension',
    'Check old and new names side by side, with duplicate names flagged before you confirm',
    'Rename in place in desktop Chromium browsers, or download renamed copies as a ZIP',
  ],
});

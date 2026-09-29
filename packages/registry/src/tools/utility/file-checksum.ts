import { defineTool } from '../../define';

export default defineTool({
  id: 'file-checksum',
  code: 'U04',
  slug: 'file-checksum',
  category: 'utility',
  name: 'File Checksum',
  tagline: 'Get MD5, SHA-1 and SHA-256 hashes of multi-GB files to prove a copy matches.',
  summary: 'MD5, SHA-1 and SHA-256, compare copies',
  status: 'soon',
  wave: 3,
  runtime: 'client',
  engines: ['text'],
  ui: 'batch',
  batch: true,
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Checksum Calculator Online, MD5 and SHA-256 | EditToolbelt',
    description:
      'Get MD5, SHA-1 and SHA-256 checksums of files, streamed so multi-GB media works. Compare two files or a pasted hash, and export the list for a batch.',
    h1: 'Checksum Calculator Online',
    primaryQuery: 'checksum calculator online',
    secondaryQueries: ['sha256 file hash'],
  },
  related: ['batch-rename', 'storage-calculator', 'video-info'],
  willDo: [
    'Hash files with MD5, SHA-1 or SHA-256, streamed so multi-GB media files work',
    'Compare two files, or check a file against a hash you paste in',
    'Export the hash list for a whole batch to verify an offload or backup copy',
  ],
});

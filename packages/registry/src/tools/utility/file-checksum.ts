import { defineTool } from '../../define';

export default defineTool({
  id: 'file-checksum',
  code: 'U04',
  slug: 'file-checksum',
  category: 'utility',
  name: 'File Checksum',
  tagline: 'Get MD5, SHA-1 and SHA-256 hashes of multi-GB files to prove a copy matches.',
  summary: 'MD5, SHA-1 and SHA-256, compare copies',
  status: 'beta',
  wave: 3,
  runtime: 'client',
  engines: ['file-hash'],
  ui: 'batch',
  batch: true,
  // Any file: only its bytes are read.
  accepts: ['*/*'],
  outputs: ['sha256', 'md5', 'sha1', 'csv'],
  limits: { client: { maxBytes: 32 * 1024 * 1024 * 1024 } },
  cost: { kind: 'free' },
  surfaces: ['web'],
  seo: {
    title: 'Checksum Calculator Online, MD5 and SHA-256 | EditToolbelt',
    description:
      'Get MD5, SHA-1 and SHA-256 checksums of files, streamed so multi-GB media works. Compare two files or a pasted hash, and export the list for a batch.',
    h1: 'Checksum Calculator Online',
    primaryQuery: 'checksum calculator online',
    secondaryQueries: ['sha256 file hash'],
    howTo: [
      'Drop the files, up to 1,000. Each is hashed with MD5, SHA-1 and SHA-256 at once, read in pieces so a 30 GB clip works.',
      'To check a copy, paste the hash you were given, or a whole SHA256SUMS or MD5 list. Each file says whether it matches.',
      'Drop the original and its copy together to compare them: the page says whether they are identical.',
      'Download the list as SHA256SUMS, MD5SUMS, SHA1SUMS or a CSV with all three, to check the copy again later.',
    ],
    faq: [
      {
        q: 'Are my files uploaded?',
        a: 'No. The hashes are worked out in this browser, and the files never leave your device. Nothing is sent, however large the file.',
      },
      {
        q: 'Which hash should I use?',
        a: 'SHA-256 for anything that matters: it is what download pages and backup tools publish. MD5 and SHA-1 are fine for spotting a bad copy, and are here because older cameras, offload apps and archives still list them.',
      },
      {
        q: 'Can I check the list on a computer later?',
        a: 'Yes. Save the SHA256SUMS list next to the files and run sha256sum -c SHA256SUMS on Linux, or shasum -a 256 -c SHA256SUMS on a Mac. The MD5 and SHA-1 lists work the same way.',
      },
    ],
  },
  related: ['batch-rename', 'storage-calculator', 'video-info'],
  willDo: [
    'Hash files with MD5, SHA-1 or SHA-256, streamed so multi-GB media files work',
    'Compare two files, or check a file against a hash you paste in',
    'Export the hash list for a whole batch to verify an offload or backup copy',
  ],
});

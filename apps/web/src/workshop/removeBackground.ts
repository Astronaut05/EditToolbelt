import type { ShellPreset, ShellTool } from '@etb/ui';

/**
 * Remove Background (P07) as the design screens show it. In M1 this drives
 * the ToolShell against the dummy engine; M2 moves it next to the real preset.
 */
export const removeBackgroundTool: ShellTool = {
  id: 'remove-background',
  name: 'Remove Background',
  h1: 'Remove Background from Image',
  tagline: 'Cut out the subject and download a transparent PNG.',
  runtime: 'hybrid',
  ui: 'canvas-editor',
  category: { name: 'Photo', href: '/photo' },
  related: [
    { name: 'Resize Image', href: '/resize-image' },
    { name: 'Compress Image', href: '/compress-image' },
    { name: 'Add Text to Image', href: '/add-text-to-image' },
  ],
  howTo: [
    'Drop or choose an image',
    'The AI finds the subject, in about 2 seconds',
    'Download a transparent PNG',
  ],
};

export const removeBackgroundPreset: ShellPreset = {
  noun: 'image',
  accept: 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif',
  maxBytes: 200_000_000,
  dropTitle: 'Drop an image here',
  chooseLabel: 'Choose image',
  tapLabel: 'Choose\nan image',
  formats: 'JPG · PNG · WEBP · AVIF · HEIC · up to 24 MP, 200 MB',
  formatsShort: 'JPG · PNG · WEBP · HEIC · up to 24 MP',
  camera: true,
  sampleUrl: '/samples/mug.jpg',
  sampleName: 'mug.jpg',
  autoRun: true,
  options: [
    {
      id: 'background',
      label: 'Background',
      default: 'transparent',
      choices: [
        { value: 'transparent', label: 'Transparent' },
        { value: 'color', label: 'Color' },
        { value: 'blur', label: 'Blur' },
        { value: 'image', label: 'Image' },
      ],
    },
    {
      id: 'edges',
      label: 'Edges',
      default: 'soft',
      choices: [
        { value: 'soft', label: 'Soft' },
        { value: 'hard', label: 'Hard' },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      default: 'png',
      choices: [
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WebP' },
      ],
    },
  ],
  phoneGroups: [['background'], ['edges', 'format']],
  facts: (state) => [
    {
      label: 'AI model',
      value:
        state.kind === 'running'
          ? 'Quality · 115 MB · first use'
          : state.kind === 'result'
            ? 'Quality · 115 MB · cached'
            : 'Quality · 115 MB',
    },
  ],
  outputExt: (options) => options.format ?? 'png',
  outputSuffix: 'nobg',
  resultTitle: 'Background removed',
  runningNote:
    'The AI model downloads once and is saved on this device. Next time it starts instantly.',
  progressTitle: (stage) => stage ?? 'Finding the subject',
  editor: { compare: true },
};

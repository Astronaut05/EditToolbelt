'use client';

import {
  canRunQuality,
  modelCached,
  removeBackgroundEngine,
  SEGMENT_MODELS,
  type SegmentModel,
} from '@etb/engines';
import { ToolShell, type ShellOption, type ShellPreset, type ShellTool } from '@etb/ui';
import { useEffect, useMemo, useState } from 'react';

import { trackUnknown } from '../lib/analytics';
import { modelUrl } from '../lib/urls';
import { IMAGE_ACCEPT } from './image-presets';

const BASE_OPTIONS: ShellOption[] = [
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
    id: 'color',
    label: 'Color',
    kind: 'color',
    default: '#ffffff',
    when: { id: 'background', values: ['color'] },
  },
  {
    id: 'backgroundImage',
    label: 'New background',
    kind: 'image',
    default: '',
    when: { id: 'background', values: ['image'] },
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
];

/** Only where quality mode runs: the choice to use the small model instead. */
const MODEL_OPTION: ShellOption = {
  id: 'model',
  label: 'AI model',
  default: 'quality',
  choices: [
    { value: 'quality', label: 'Quality' },
    { value: 'light', label: 'Light' },
  ],
};

const MODELS_BASE = modelUrl('');

/** Which models are already on this device (in the models cache). */
function useCachedModels() {
  const [cached, setCached] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(
      Object.values(SEGMENT_MODELS).map(
        async (model) => [model.id, await modelCached(model, MODELS_BASE)] as const,
      ),
    ).then((entries) => {
      if (live) setCached(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, []);
  return cached;
}

function modelFor(quality: boolean | null, choice: string | undefined): SegmentModel {
  return quality && choice !== 'light' ? SEGMENT_MODELS['birefnet-lite'] : SEGMENT_MODELS.u2netp;
}

/** P07 Remove Background (tools/photo.md). */
export default function RemoveBackground({ tool }: { tool: ShellTool }) {
  // null until checked: WebGPU with 16-bit floats decides whether quality mode runs.
  const [quality, setQuality] = useState<boolean | null>(null);
  useEffect(() => {
    void canRunQuality().then(setQuality);
  }, []);
  const cached = useCachedModels();

  const preset = useMemo<ShellPreset>(
    () => ({
      noun: 'image',
      accept: IMAGE_ACCEPT,
      maxBytes: 200 * 1024 * 1024,
      dropTitle: 'Drop an image here',
      chooseLabel: 'Choose image',
      tapLabel: 'Choose\nan image',
      formats: 'JPG · PNG · WEBP · AVIF · HEIC · up to 24 MP, 200 MB',
      formatsShort: 'JPG · PNG · WEBP · HEIC · up to 24 MP',
      camera: true,
      sampleUrl: '/samples/mug.jpg',
      sampleName: 'mug.jpg',
      autoRun: true,
      options: quality ? [...BASE_OPTIONS, MODEL_OPTION] : BASE_OPTIONS,
      phoneGroups: [
        ['background', 'color', 'backgroundImage'],
        ['edges', 'format'],
        ...(quality ? [['model']] : []),
      ],
      facts: (state, options) => {
        const model = modelFor(quality, options.model);
        const onDevice = cached[model.id] === true || state.kind === 'result';
        const facts = [
          {
            label: quality ? 'Download' : 'AI model',
            value: `${model.label}${onDevice ? ' · cached' : state.kind === 'running' ? ' · first use' : ''}`,
          },
        ];
        if (model.id === 'u2netp') {
          facts.push({
            label: 'Light mode',
            value: quality ? 'Smaller download, rougher hair' : 'No WebGPU here: rougher hair',
          });
        }
        return facts;
      },
      outputExt: (options) => options.format ?? 'png',
      outputSuffix: 'nobg',
      resultTitle: 'Background removed',
      runningNote: cached[modelFor(quality, undefined).id]
        ? undefined
        : 'The AI model downloads once and is saved on this device. Next time it starts instantly.',
      progressTitle: (stage) => stage ?? 'Finding the subject',
      editor: { compare: true, refine: 'refine' },
    }),
    [cached, quality],
  );

  return (
    <ToolShell
      tool={tool}
      preset={preset}
      engine={removeBackgroundEngine}
      engineOptions={{ modelsBase: MODELS_BASE }}
      onEvent={trackUnknown}
    />
  );
}

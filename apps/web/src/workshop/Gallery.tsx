'use client';

import { useState, type ReactNode } from 'react';

import {
  BatchList,
  BeforeAfter,
  Breadcrumb,
  Button,
  ButtonLink,
  CanvasEditor,
  CapabilityNotice,
  Card,
  ColorInput,
  CreditBadge,
  Dialog,
  DropZone,
  EmptyState,
  ErrorState,
  FactGrid,
  Input,
  Kbd,
  MonoLabel,
  NumberedList,
  NumberWithUnit,
  OptionFact,
  OptionRow,
  OptionsPanel,
  PresetPicker,
  PriceConfirm,
  PrivacyBadge,
  ProgressBar,
  Readout,
  ReadoutRow,
  SegmentedControl,
  Select,
  Slider,
  StatusTag,
  Switch,
  Tabs,
  Tag,
  ThemeToggle,
  Timeline,
  Toast,
  Tooltip,
  Wordmark,
} from '@etb/ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-8" aria-labelledby={`g-${title}`}>
      <MonoLabel as="h2" size="md" id={`g-${title}`}>
        {title}
      </MonoLabel>
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Every component in packages/ui, in its states (docs/03 → Shared components). */
export function Gallery() {
  const [segment, setSegment] = useState('png');
  const [on, setOn] = useState(true);
  const [color, setColor] = useState('#B9E04C');
  const [preset, setPreset] = useState('story');
  const [dialog, setDialog] = useState<'dialog' | 'sheet' | null>(null);
  const [range, setRange] = useState({ start: 8, end: 26 });
  const [dropped, setDropped] = useState('Nothing yet');

  return (
    <div className="max-w-5xl px-4 pb-16 lg:px-10">
      <Section title="Wordmark, tags, labels">
        <div className="flex flex-wrap items-center gap-6">
          <Wordmark />
          <Wordmark size="lg" />
          <Tag>Browser</Tag>
          <Tag tone="accent">AI · Browser</Tag>
          <Tag>Soon</Tag>
          <StatusTag>Coming soon</StatusTag>
          <StatusTag>Beta</StatusTag>
          <Kbd>Ctrl</Kbd>
          <Kbd>V</Kbd>
          <CreditBadge credits={120} />
        </div>
        <Breadcrumb items={[{ label: 'Photo', href: '/photo' }, { label: 'Remove Background' }]} />
        <PrivacyBadge runtime="client" noun="image" />
        <PrivacyBadge runtime="server-gpu" noun="image" />
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Download PNG · 3.1 MB</Button>
          <Button>Start over</Button>
          <Button variant="primary" disabled>
            Download PNG
          </Button>
          <Button size="md">Medium, 44 px</Button>
          <Button size="sm">Small</Button>
          <ButtonLink href="/photo">Link as button</ButtonLink>
          <Tooltip label="Ctrl/Cmd+S">
            <Button>With tooltip</Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Settings rows">
        <OptionsPanel className="max-w-120">
          <OptionRow label="Format">
            <SegmentedControl
              label="Format"
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP' },
                { value: 'jpg', label: 'JPG' },
              ]}
            />
          </OptionRow>
          <OptionRow label="Width" htmlFor="g-width">
            <NumberWithUnit id="g-width" unit="px" defaultValue={1080} />
          </OptionRow>
          <OptionRow label="Quality" htmlFor="g-quality">
            <Slider id="g-quality" min={1} max={100} defaultValue={82} />
          </OptionRow>
          <OptionRow label="Fit" htmlFor="g-fit">
            <Select id="g-fit" defaultValue="cover">
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </Select>
          </OptionRow>
          <OptionRow label="Keep metadata">
            <Switch label="Keep metadata" checked={on} onChange={setOn} />
          </OptionRow>
          <OptionRow label="Background">
            <ColorInput label="Background color" value={color} onChange={setColor} />
          </OptionRow>
          <OptionFact label="AI model">Quality · 115 MB · cached</OptionFact>
        </OptionsPanel>
        <Input placeholder="Text input" className="max-w-80" aria-label="Text input" />
        <div className="max-w-120">
          <PresetPicker
            label="Preset"
            value={preset}
            onChange={setPreset}
            presets={[
              { id: 'story', label: 'Instagram Story', detail: '1080 × 1920 px' },
              { id: 'thumb', label: 'YouTube thumbnail', detail: '1280 × 720 px' },
              { id: 'discord', label: 'Discord', detail: '10 MB' },
              { id: 'custom', label: 'Custom', detail: 'Any size' },
            ]}
          />
        </div>
      </Section>

      <Section title="Lists and tabs">
        <NumberedList
          items={[
            'Drop or choose an image',
            'The AI finds the subject',
            'Download a transparent PNG',
          ]}
        />
        <NumberedList
          variant="prose"
          items={['Enlarge 2× or 4×', 'Preview a crop before you use credits']}
        />
        <Tabs
          label="Example tabs"
          items={[
            { id: 'all', label: 'All', count: 19, content: <p className="text-14">All tools.</p> },
            {
              id: 'browser',
              label: 'In browser',
              count: 17,
              content: <p className="text-14">Browser tools.</p>,
            },
            { id: 'ai', label: 'AI', count: 4, content: <p className="text-14">AI tools.</p> },
          ]}
        />
      </Section>

      <Section title="States">
        <EmptyState
          label="Step 1"
          title="Drop an image here"
          body="Or choose a file."
          actions={<Button variant="primary">Choose image</Button>}
        />
        <ErrorState
          label="Couldn’t read this file"
          title="This file isn’t an image we can read"
          body="Try JPG, PNG, WebP, AVIF or HEIC."
          actions={<Button variant="primary">Try another file</Button>}
        />
        <CapabilityNotice title="Your browser can’t encode AVIF">
          Choose WebP or JPG, or open this page in a current Chrome or Firefox.
        </CapabilityNotice>
        <PriceConfirm
          credits={6}
          balance={120}
          actions={<Button variant="primary">Use 6 credits</Button>}
        />
        <PriceConfirm credits={6} balance={4} />
        <Toast>Copied to clipboard</Toast>
        <Toast tone="danger" onDismiss={() => undefined}>
          The download failed. Try again.
        </Toast>
        <Card className="p-4 text-14">Card: the bordered exception to hairlines.</Card>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setDialog('dialog');
            }}
          >
            Open dialog
          </Button>
          <Button
            onClick={() => {
              setDialog('sheet');
            }}
          >
            Open bottom sheet
          </Button>
        </div>
        <Dialog
          open={dialog !== null}
          variant={dialog ?? 'dialog'}
          title={dialog === 'sheet' ? 'Settings' : 'Dialog'}
          onClose={() => {
            setDialog(null);
          }}
        >
          <p className="text-14">
            Esc, the close button or a click outside closes it. Focus returns to the opener.
          </p>
        </Dialog>
        <div className="flex items-center gap-4">
          <MonoLabel as="span">Theme</MonoLabel>
          <ThemeToggle />
        </div>
      </Section>

      <Section title="Drop zone">
        <div className="relative h-100 border border-border">
          <DropZone
            accept="image/*"
            maxBytes={200_000_000}
            noun="image"
            title="Drop an image here"
            chooseLabel="Choose image"
            tapLabel={'Choose\nan image'}
            formats="JPG · PNG · WEBP · AVIF · HEIC · up to 24 MP, 200 MB"
            camera
            active={false}
            onFiles={(files) => {
              setDropped(files.map((file) => file.name).join(', '));
            }}
            onReject={setDropped}
            onSample={() => {
              setDropped('Sample chosen');
            }}
          />
        </div>
        <p className="font-mono text-12.5 text-text-muted">Last input: {dropped}</p>
      </Section>

      <Section title="Preview, progress, readout">
        <div className="relative h-100 overflow-hidden">
          <BeforeAfter
            className="absolute inset-0"
            before={
              // eslint-disable-next-line @next/next/no-img-element -- sample file
              <img src="/samples/mug.jpg" alt="" className="size-full object-cover" />
            }
            after={
              // eslint-disable-next-line @next/next/no-img-element -- sample file
              <img src="/samples/mug-cutout.png" alt="Cut-out" className="size-full object-cover" />
            }
          />
          <Readout
            facts={[
              { label: 'Dimensions', value: '3024 × 4032 px' },
              { label: 'Size', value: '4.8 MB → 3.1 MB' },
              { label: 'Time', value: '1.9 s' },
              { label: 'Engine', value: 'WebGPU' },
            ]}
          />
        </div>
        <ReadoutRow
          facts={[
            { label: 'Dimensions', value: '3024 × 4032', unit: 'px' },
            { label: 'Size', value: '3.1 MB', unit: 'PNG' },
            { label: 'Time', value: '1.9 s' },
          ]}
        />
        <div className="relative h-40 bg-surface">
          <ProgressBar
            title="Downloading the AI model, first time only"
            fraction={0.64}
            meta={{
              amount: '74 / 115 MB',
              step: 'Step 1 of 2 · then finding the subject',
              elapsedSec: 3.8,
            }}
          />
        </div>
        <div className="relative h-40 bg-surface">
          <ProgressBar title="Reading the file" meta={{ elapsedSec: 0.4 }} />
        </div>
      </Section>

      <Section title="Canvas editor, timeline">
        <div className="relative h-100 border border-border">
          <CanvasEditor
            // eslint-disable-next-line @next/next/no-img-element -- sample file
            image={<img src="/samples/mug.jpg" alt="" className="size-full object-contain" />}
          />
        </div>
        <Timeline durationSec={60} kind="audio" value={range} onChange={setRange} />
        <Timeline durationSec={60} kind="video" value={range} onChange={setRange} />
      </Section>

      <Section title="Batch list, results">
        <BatchList
          items={[
            {
              id: '1',
              name: 'holiday-01.jpg',
              size: 4_200_000,
              status: 'done',
              resultSize: 820_000,
            },
            { id: '2', name: 'holiday-02.jpg', size: 3_900_000, status: 'running', progress: 0.42 },
            { id: '3', name: 'holiday-03.heic', size: 2_100_000, status: 'queued' },
            {
              id: '4',
              name: 'broken.png',
              size: 12_000,
              status: 'failed',
              error: 'Couldn’t read this file.',
            },
          ]}
          onDownload={() => undefined}
        />
        <FactGrid
          facts={[
            { label: 'Tempo', value: '124', unit: 'BPM' },
            { label: 'Key', value: 'A minor' },
            { label: 'Integrated', value: '-14.2', unit: 'LUFS' },
            { label: 'True peak', value: '-1.0', unit: 'dBTP' },
          ]}
        />
      </Section>
    </div>
  );
}

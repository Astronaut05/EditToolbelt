'use client';

import { addUserFont, TEXT_FONTS, type TextAlign, type TextLayer } from '@etb/engines';
import { Bold, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/Button';
import { ColorInput, NumberWithUnit, Select, Slider, Switch } from '../primitives/fields';
import { SegmentedControl } from '../primitives/SegmentedControl';

const WIDE = '(min-width: 64rem)';
function subscribeWide(onChange: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

const ALIGNS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/** A label and its control, side by side. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <span className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className="text-14 text-text-muted">
        {label}
      </Label>
      {children}
    </span>
  );
}

/**
 * The text mode's panel: the layers (choose, add, remove) and the chosen
 * layer's text, font (bundled, or a font file of your own, which stays on
 * this device), size, weight, colour, alignment, outline, shadow, box and
 * rotation.
 */
export function TextBar({
  layers,
  selected,
  onSelect,
  onLayers,
  onAdd,
}: {
  layers: readonly TextLayer[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onLayers: (layers: TextLayer[], transient?: boolean) => void;
  onAdd: () => void;
}) {
  const ids = {
    text: useId(),
    font: useId(),
    size: useId(),
    stroke: useId(),
    rotation: useId(),
    opacity: useId(),
  };
  const fileInput = useRef<HTMLInputElement>(null);
  // Every control shows on a desktop; a phone keeps the image in view and folds the styling away.
  const wide = useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE).matches,
    () => true,
  );
  const [userFonts, setUserFonts] = useState<{ value: string; label: string }[]>([]);
  const [fontError, setFontError] = useState<string | null>(null);
  const layer = layers.find((candidate) => candidate.id === selected);
  const change = (patch: Partial<TextLayer>, transient = false) => {
    if (!layer) return;
    onLayers(
      layers.map((candidate) =>
        candidate.id === layer.id ? { ...candidate, ...patch } : candidate,
      ),
      transient,
    );
  };

  return (
    <div className="flex max-h-[55%] flex-none flex-col gap-1 overflow-y-auto border-b border-border bg-bg px-3 py-2 lg:max-h-none">
      <div className="flex flex-wrap items-center gap-2">
        <span role="group" aria-label="Text layers" className="flex flex-wrap items-center gap-1.5">
          {layers.map((candidate, i) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === selected}
              onClick={() => {
                onSelect(candidate.id);
              }}
              className={cn(
                'inline-flex h-9 max-w-40 items-center gap-1.5 rounded-control border px-2.5 text-13',
                candidate.id === selected
                  ? 'border-text font-strong text-text'
                  : 'border-border text-text-muted hover:border-text hover:text-text',
              )}
            >
              <span className="font-mono text-11.5">{i + 1}</span>
              <span className="truncate">{candidate.text.split('\n')[0] || 'Empty'}</span>
            </button>
          ))}
        </span>
        <Button
          size="sm"
          onClick={onAdd}
          icon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
        >
          Add text
        </Button>
        {layer && (
          <Button
            size="sm"
            onClick={() => {
              onLayers(layers.filter((candidate) => candidate.id !== layer.id));
              onSelect(null);
            }}
            icon={<Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />}
          >
            Remove
          </Button>
        )}
        {!layer && (
          <span className="text-13 text-text-muted">
            Click the image to add text there, or choose a layer.
          </span>
        )}
      </div>
      {layer && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label htmlFor={ids.text} className="sr-only">
            Text
          </label>
          <textarea
            id={ids.text}
            rows={2}
            value={layer.text}
            placeholder="Type the text; Enter starts a new line"
            onChange={(event) => {
              change({ text: event.target.value });
            }}
            className="min-h-11 w-full resize-y rounded-control border border-border-field bg-bg px-2.5 py-1.5 text-14 text-text hover:border-text focus-visible:border-text lg:w-64"
          />
          <Field label="Font" htmlFor={ids.font}>
            <Select
              id={ids.font}
              className="w-40"
              value={layer.font}
              onChange={(event) => {
                if (event.target.value === 'load') {
                  fileInput.current?.click();
                  return;
                }
                change({ font: event.target.value });
              }}
            >
              {TEXT_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
              {userFonts.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
              <option value="load">Your own font file…</option>
            </Select>
            <input
              ref={fileInput}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="sr-only"
              tabIndex={-1}
              aria-label="Font file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setFontError(null);
                addUserFont(file).then(
                  (font) => {
                    setUserFonts((fonts) =>
                      fonts.some((f) => f.value === font)
                        ? fonts
                        : [...fonts, { value: font, label: file.name.replace(/\.[^.]+$/, '') }],
                    );
                    change({ font });
                  },
                  () => {
                    setFontError(
                      'That file isn’t a font this browser can read. Try a TTF, OTF or WOFF2.',
                    );
                  },
                );
              }}
            />
          </Field>
          <Field label="Size" htmlFor={ids.size}>
            <NumberWithUnit
              id={ids.size}
              unit="px"
              min={4}
              max={2000}
              value={layer.size}
              onChange={(event) => {
                const size = Number(event.target.value);
                if (size >= 1) change({ size });
              }}
              className="w-24"
            />
          </Field>
          <button
            type="button"
            aria-pressed={layer.bold}
            aria-label="Bold"
            title="Bold"
            onClick={() => {
              change({ bold: !layer.bold });
            }}
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-control',
              layer.bold ? 'text-text' : 'text-text-muted hover:text-text',
            )}
          >
            <span
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-control',
                layer.bold && 'bg-surface ring-1 ring-text',
              )}
            >
              <Bold size={16} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
          <ColorInput
            label="Colour"
            value={layer.color}
            onChange={(color) => {
              change({ color });
            }}
          />
        </div>
      )}
      {layer && (
        <details open={wide} className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-14 text-text-muted hover:text-text">
            More: alignment, outline, shadow, box, rotation
          </summary>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <SegmentedControl
              label="Align"
              options={ALIGNS}
              value={layer.align}
              onChange={(align) => {
                change({ align });
              }}
            />
            <Field label="Outline" htmlFor={ids.stroke}>
              <NumberWithUnit
                id={ids.stroke}
                unit="px"
                min={0}
                max={200}
                value={layer.stroke}
                onChange={(event) => {
                  change({ stroke: Math.max(0, Number(event.target.value) || 0) });
                }}
                className="w-24"
              />
              <ColorInput
                label="Outline colour"
                value={layer.strokeColor}
                onChange={(strokeColor) => {
                  change({ strokeColor });
                }}
              />
            </Field>
            <Field label="Shadow">
              <Switch
                label="Shadow"
                checked={layer.shadow}
                onChange={(shadow) => {
                  change({ shadow });
                }}
              />
            </Field>
            <Field label="Box">
              <Switch
                label="Box"
                checked={layer.box}
                onChange={(box) => {
                  change({ box });
                }}
              />
              {layer.box && (
                <>
                  <ColorInput
                    label="Box colour"
                    value={layer.boxColor}
                    onChange={(boxColor) => {
                      change({ boxColor });
                    }}
                  />
                  <Slider
                    id={ids.opacity}
                    aria-label="Box opacity"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(layer.boxOpacity * 100)}
                    onChange={(event) => {
                      change({ boxOpacity: Number(event.target.value) / 100 });
                    }}
                    className="w-24"
                  />
                  <output htmlFor={ids.opacity} className="w-10 font-mono text-12.5">
                    {Math.round(layer.boxOpacity * 100)}%
                  </output>
                </>
              )}
            </Field>
            <Field label="Rotate" htmlFor={ids.rotation}>
              <Slider
                id={ids.rotation}
                min={-180}
                max={180}
                value={layer.rotation}
                aria-valuetext={`${String(layer.rotation)}°`}
                onChange={(event) => {
                  change({ rotation: Number(event.target.value) });
                }}
                className="w-32"
              />
              <output htmlFor={ids.rotation} className="w-12 font-mono text-12.5">
                {layer.rotation}°
              </output>
            </Field>
          </div>
        </details>
      )}
      {fontError && (
        <p role="alert" className="text-13">
          {fontError}
        </p>
      )}
    </div>
  );
}

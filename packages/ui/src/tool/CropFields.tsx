'use client';

import { turnedSize, type Rect } from '@etb/engines';
import { Crosshair } from 'lucide-react';
import { useState } from 'react';

import { OptionRow } from '../primitives/OptionsPanel';
import { NumberWithUnit } from '../primitives/fields';
import { centreBox, moveBox, setBoxSize } from './crop';
import type { EditorState } from './useEditor';

/**
 * A number that can be cleared and retyped: the text is kept while typing,
 * each valid number updates the box at once, and leaving the field makes the
 * change one undo step.
 */
function BoxNumber({
  label,
  value,
  max,
  onValue,
  onDone,
}: {
  label: string;
  value: number;
  max: number;
  onValue: (value: number) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <NumberWithUnit
      aria-label={label}
      unit="px"
      min={0}
      max={max}
      step={1}
      inputMode="numeric"
      className="w-24"
      value={draft ?? String(value)}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const number = Number(text);
        if (text.trim() !== '' && Number.isFinite(number)) onValue(Math.round(number));
      }}
      onBlur={() => {
        setDraft(null);
        onDone();
      }}
    />
  );
}

/** The crop box as numbers: size and position in px, and a Center button. */
export function CropFields({ editor, ratio }: { editor: EditorState; ratio: number | null }) {
  const { edit, natural, onEdit } = editor;
  if (!natural || !edit.crop) return null;
  const bounds = turnedSize(natural, edit.turns);
  const box = edit.crop;
  const live = (crop: Rect) => {
    onEdit({ ...edit, crop }, true);
  };
  const done = () => {
    onEdit(edit);
  };
  return (
    <>
      <OptionRow label="Crop box">
        <span className="flex items-center gap-2">
          <BoxNumber
            label="Crop width"
            value={box.width}
            max={bounds.width}
            onValue={(value) => {
              live(setBoxSize(box, 'width', value, bounds, ratio));
            }}
            onDone={done}
          />
          <span aria-hidden="true" className="w-2 text-center text-text-muted">
            ×
          </span>
          <BoxNumber
            label="Crop height"
            value={box.height}
            max={bounds.height}
            onValue={(value) => {
              live(setBoxSize(box, 'height', value, bounds, ratio));
            }}
            onDone={done}
          />
          {/* Keeps the columns in line with the Center button below. */}
          <span aria-hidden="true" className="size-11 flex-none" />
        </span>
      </OptionRow>
      <OptionRow label="Position">
        <span className="flex items-center gap-2">
          <BoxNumber
            label="Crop left edge, X"
            value={box.x}
            max={bounds.width - box.width}
            onValue={(value) => {
              live(moveBox(box, value - box.x, 0, bounds));
            }}
            onDone={done}
          />
          <span aria-hidden="true" className="w-2 text-center text-text-muted">
            ,
          </span>
          <BoxNumber
            label="Crop top edge, Y"
            value={box.y}
            max={bounds.height - box.height}
            onValue={(value) => {
              live(moveBox(box, 0, value - box.y, bounds));
            }}
            onDone={done}
          />
          <button
            type="button"
            aria-label="Center the crop box"
            title="Center"
            onClick={() => {
              onEdit({ ...edit, crop: centreBox(box, bounds) });
            }}
            className="inline-flex size-11 flex-none items-center justify-center rounded-control border border-border text-text-muted hover:border-text hover:text-text"
          >
            <Crosshair size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </OptionRow>
    </>
  );
}

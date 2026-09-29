'use client';

import { cn } from '../cn';

export interface Preset {
  id: string;
  label: string;
  /** The numbers, always visible: "1080 × 1920 px", "10 MB". */
  detail: string;
}

/** Named presets as hairline rows; "Custom" keeps free values possible (docs/03). */
export function PresetPicker({
  presets,
  value,
  onChange,
  label,
}: {
  presets: Preset[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="border-t border-border">
        {presets.map((preset) => {
          const selected = preset.id === value;
          return (
            <label
              key={preset.id}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-b border-border text-14 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name={label}
                  value={preset.id}
                  checked={selected}
                  onChange={() => {
                    onChange(preset.id);
                  }}
                  className="sr-only"
                />
                <span
                  className={cn(
                    selected ? 'font-strong text-text underline-accent' : 'text-text-muted',
                  )}
                >
                  {preset.label}
                </span>
              </span>
              <span className="font-mono text-12.5 uppercase text-text-muted">{preset.detail}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

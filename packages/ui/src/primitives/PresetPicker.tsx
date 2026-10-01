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

export interface PresetGroup {
  label: string;
  presets: Preset[];
}

/**
 * Several presets at once (P13's sizes): checkbox rows grouped under small
 * mono headings, the numbers always visible. The value is the picked ids,
 * comma-separated, in the order the groups list them.
 */
export function PresetChecklist({
  groups,
  value,
  onChange,
  label,
}: {
  groups: PresetGroup[];
  value: string;
  onChange: (ids: string) => void;
  label: string;
}) {
  const picked = new Set(value.split(',').filter(Boolean));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    onChange(
      groups
        .flatMap((group) => group.presets.map((preset) => preset.id))
        .filter((presetId) => next.has(presetId))
        .join(','),
    );
  };
  return (
    <fieldset className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <legend className="sr-only">{label}</legend>
      {groups.map((group) => (
        <fieldset key={group.label}>
          <legend className="mb-1.5 font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
            {group.label}
          </legend>
          <div className="border-t border-border">
            {group.presets.map((preset) => {
              const selected = picked.has(preset.id);
              return (
                <label
                  key={preset.id}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-b border-border text-14 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      value={preset.id}
                      checked={selected}
                      onChange={(event) => {
                        toggle(preset.id, event.target.checked);
                      }}
                      className="size-4 shrink-0 cursor-pointer accent-(--accent) focus-visible:outline-none"
                    />
                    <span className={cn(selected ? 'font-strong text-text' : 'text-text-muted')}>
                      {preset.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-12.5 text-text-muted">
                    {preset.detail}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </fieldset>
  );
}

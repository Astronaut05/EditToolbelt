'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Input } from '../primitives/fields';
import type { ShellOption } from './ToolShell';

/** A value kept in localStorage, or null when there is none or storage is off. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const SECRET_CHANGE = 'etb:secret';

function store(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage off (a private window): the key lasts as long as the page.
  }
  window.dispatchEvent(new Event(SECRET_CHANGE));
}

function subscribeStored(onChange: () => void) {
  window.addEventListener(SECRET_CHANGE, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SECRET_CHANGE, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * A key the person pastes (`secret` options): masked, and remembered on this
 * device only while Remember is ticked. Unticking forgets it at once.
 */
export function SecretField({
  option,
  value,
  onChange,
}: {
  option: ShellOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const key = option.remember;
  const kept = useSyncExternalStore(
    subscribeStored,
    () => (key ? stored(key) : null),
    () => null,
  );
  // Ticked or not by the person; until then, ticked when a key is kept.
  const [choice, setChoice] = useState<boolean | null>(null);
  const remember = choice ?? kept !== null;
  // A kept key fills the field once, when the page opens.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || kept === null) return;
    filled.current = true;
    if (!value) onChange(kept);
  }, [kept, value, onChange]);
  return (
    <span className="flex w-full min-w-0 flex-col gap-1 sm:w-72">
      <Input
        type="password"
        aria-label={option.label}
        placeholder={option.placeholder}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        value={value}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next);
          if (key && remember) store(key, next);
        }}
      />
      {key && (
        <label className="inline-flex min-h-11 items-center gap-2 text-14">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              setChoice(event.target.checked);
              store(key, event.target.checked ? value : null);
            }}
          />
          Remember on this device
        </label>
      )}
    </span>
  );
}
